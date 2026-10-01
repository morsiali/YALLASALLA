-- Row Level Security. Identity comes from the transaction-local setting app.user_id, which the API sets
-- after verifying a signed token. The ROLE is always read from the users table (never from the client).
-- Roles: yalasala_app (subject to RLS, column-limited grants) and yalasala_service (BYPASSRLS, server-only).

create function app_role() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select role from users where id = app_uid() and status <> 'deleted'), 'anon') $$;
create function is_admin() returns boolean language sql stable as $$ select app_role() = 'admin' $$;
create function is_staff_ops() returns boolean language sql stable as $$ select app_role() in ('admin','support') $$;

create function is_owner(b uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from business_members where business_id = b and user_id = app_uid() and member_role = 'owner') $$;

create function member_perm(b uuid, perm text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from business_members m where m.business_id = b and m.user_id = app_uid()
                  and (m.member_role = 'owner' or perm = any (m.permissions))) $$;

create function is_member(b uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from business_members where business_id = b and user_id = app_uid()) $$;

create function business_writable(b uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from businesses where id = b and status in ('draft','pending','approved')) $$;

create function business_public(b uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from businesses where id = b and status = 'approved') $$;

create function store_business(s uuid) returns uuid language sql stable security definer set search_path = public as
$$ select business_id from stores where id = s $$;

create function store_public(s uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from stores st join businesses b on b.id = st.business_id
                  where st.id = s and st.active and b.status = 'approved') $$;

create function product_business(p uuid) returns uuid language sql stable security definer set search_path = public as
$$ select st.business_id from products pr join stores st on st.id = pr.store_id where pr.id = p $$;

create function order_customer(o uuid) returns uuid language sql stable security definer set search_path = public as
$$ select customer_id from orders where id = o $$;
create function order_business(o uuid) returns uuid language sql stable security definer set search_path = public as
$$ select business_id from orders where id = o $$;

-- Which side of a conversation is the caller on? 'customer' | 'business' | null
create function conv_side(c uuid) returns text language sql stable security definer set search_path = public as
$$ select case when cv.customer_id = app_uid() then 'customer'
               when member_perm(cv.business_id, 'conversations') then 'business' end
   from conversations cv where cv.id = c $$;

create function conv_blocked(c uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select blocked_by_customer or blocked_by_business from conversations where id = c), true) $$;

-- Support/admin may only read a conversation that someone has reported (moderation access, auditable).
create function conv_reported(c uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from reports r where r.status = 'open' and
        ((r.target_type = 'conversation' and r.target_id = c)
      or (r.target_type = 'message' and r.target_id in (select id from messages where conversation_id = c)))) $$;

create function conv_access(c uuid) returns boolean language sql stable as
$$ select conv_side(c) is not null or (is_staff_ops() and conv_reported(c)) $$;

-- ── enable RLS everywhere ──
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ── users ──
create policy users_self on users for select using (id = app_uid() or is_staff_ops());
create policy users_self_upd on users for update using (id = app_uid()) with check (id = app_uid());
-- consents
create policy consents_sel on consents for select using (user_id = app_uid() or is_staff_ops());
create policy consents_ins on consents for insert with check (user_id = app_uid());
-- reference data
create policy areas_sel on areas for select using (true);
create policy areas_adm on areas for all using (is_admin()) with check (is_admin());
create policy categories_sel on categories for select using (true);
create policy categories_adm on categories for all using (is_admin()) with check (is_admin());
create policy packages_sel on packages for select using (active or is_admin());
create policy packages_adm on packages for all using (is_admin()) with check (is_admin());
create policy basket_rules_sel on basket_rules for select using (true);
create policy basket_rules_adm on basket_rules for all using (is_admin()) with check (is_admin());
create policy loyalty_rules_sel on loyalty_rules for select using (true);
create policy loyalty_rules_adm on loyalty_rules for update using (is_admin()) with check (is_admin());
-- addresses
create policy addresses_own on addresses for all using (user_id = app_uid()) with check (user_id = app_uid());
-- businesses
create policy businesses_sel on businesses for select
  using (status = 'approved' or owner_id = app_uid() or is_member(id) or is_staff_ops());
create policy businesses_ins on businesses for insert
  with check (owner_id = app_uid() and app_role() = 'merchant' and status in ('draft','pending'));
create policy businesses_upd on businesses for update
  using (is_owner(id) or is_admin()) with check (is_owner(id) or is_admin());
create policy members_sel on business_members for select
  using (user_id = app_uid() or is_member(business_id) or is_staff_ops());
create policy members_ins on business_members for insert
  with check (is_admin() or is_owner(business_id) or
              (user_id = app_uid() and member_role = 'owner'
               and exists (select 1 from businesses b where b.id = business_id and b.owner_id = app_uid())));
create policy members_upd on business_members for update using (is_admin() or is_owner(business_id))
  with check (is_admin() or is_owner(business_id));
create policy members_del on business_members for delete using ((is_admin() or is_owner(business_id)) and member_role <> 'owner');
create policy subscriptions_sel on subscriptions for select using (is_member(business_id) or is_staff_ops());
-- stores
create policy stores_sel on stores for select using (store_public(id) or is_member(business_id) or is_staff_ops());
create policy stores_ins on stores for insert with check ((is_owner(business_id) and business_writable(business_id)) or is_admin());
create policy stores_upd on stores for update using ((is_owner(business_id) and business_writable(business_id)) or is_admin())
  with check ((is_owner(business_id) and business_writable(business_id)) or is_admin());
create policy store_areas_sel on store_areas for select using (true);
create policy store_areas_w on store_areas for all
  using (is_admin() or (is_owner(store_business(store_id)) and business_writable(store_business(store_id))))
  with check (is_admin() or (is_owner(store_business(store_id)) and business_writable(store_business(store_id))));
-- catalog
create policy products_sel on products for select
  using ((active and store_public(store_id)) or is_member(store_business(store_id)) or is_staff_ops());
create policy products_w on products for all
  using (is_admin() or (member_perm(store_business(store_id), 'catalog') and business_writable(store_business(store_id))))
  with check (is_admin() or (member_perm(store_business(store_id), 'catalog') and business_writable(store_business(store_id))));
create policy alternatives_sel on product_alternatives for select using (true);
create policy alternatives_w on product_alternatives for all
  using (is_admin() or member_perm(product_business(product_id), 'catalog'))
  with check (is_admin() or (member_perm(product_business(product_id), 'catalog')
                             and product_business(product_id) = product_business(alternative_id)));
create policy ready_sel on ready_baskets for select
  using ((active and store_public(store_id)) or is_member(store_business(store_id)) or is_staff_ops());
create policy ready_w on ready_baskets for all
  using (is_admin() or member_perm(store_business(store_id), 'catalog'))
  with check (is_admin() or member_perm(store_business(store_id), 'catalog'));
create policy ready_items_sel on ready_basket_items for select using (true);
create policy ready_items_w on ready_basket_items for all
  using (is_admin() or exists (select 1 from ready_baskets rb where rb.id = ready_basket_id
         and member_perm(store_business(rb.store_id), 'catalog')))
  with check (is_admin() or exists (select 1 from ready_baskets rb where rb.id = ready_basket_id
         and member_perm(store_business(rb.store_id), 'catalog')));
-- baskets / saved
create policy basket_gen_own on basket_generations for select using (user_id = app_uid() or is_admin());
create policy basket_gen_ins on basket_generations for insert with check (user_id = app_uid());
create policy basket_gen_upd on basket_generations for update using (user_id = app_uid()) with check (user_id = app_uid());
create policy saved_items_own on saved_items for all using (user_id = app_uid()) with check (user_id = app_uid());
create policy saved_baskets_own on saved_baskets for all using (user_id = app_uid()) with check (user_id = app_uid());
-- messaging
-- NOTE: policies on conversations must test the row's own columns (a function reading the same table cannot see
-- a row inserted in the same statement, which would break INSERT ... RETURNING).
create policy conv_sel on conversations for select
  using (customer_id = app_uid() or member_perm(business_id, 'conversations') or (is_staff_ops() and conv_reported(id)));
create policy conv_ins on conversations for insert
  with check (customer_id = app_uid() and store_public(store_id) and business_id = store_business(store_id));
create policy conv_upd on conversations for update
  using (customer_id = app_uid() or member_perm(business_id, 'conversations'))
  with check (customer_id = app_uid() or member_perm(business_id, 'conversations'));
create policy msg_sel on messages for select using (conv_access(conversation_id));
create policy msg_ins on messages for insert
  with check (sender_id = app_uid() and sender_side = conv_side(conversation_id) and not conv_blocked(conversation_id)
              and kind in ('text','image','voice','reference'));
create policy att_sel on attachments for select using (conv_access(conversation_id));
create policy att_ins on attachments for insert
  with check (uploader_id = app_uid() and conv_side(conversation_id) is not null and not conv_blocked(conversation_id));
-- both parties may see read state (it powers "read" receipts); each side may only write its own marker
create policy reads_sel on conversation_reads for select using (conv_side(conversation_id) is not null);
create policy reads_ins on conversation_reads for insert with check (conv_side(conversation_id) = side);
create policy reads_upd on conversation_reads for update using (conv_side(conversation_id) = side) with check (conv_side(conversation_id) = side);
create policy transcripts_sel on transcriptions for select using (requested_by = app_uid());
-- orders (writes happen only through the service role after explicit authorization; see docs/SECURITY.md)
create policy orders_sel on orders for select
  using (customer_id = app_uid() or member_perm(business_id, 'orders') or is_staff_ops());
create policy order_items_sel on order_items for select
  using (order_customer(order_id) = app_uid() or member_perm(order_business(order_id), 'orders') or is_staff_ops());
create policy order_hist_sel on order_status_history for select
  using (order_customer(order_id) = app_uid() or member_perm(order_business(order_id), 'orders') or is_staff_ops());
create policy subst_sel on substitution_requests for select
  using (order_customer(order_id) = app_uid() or member_perm(order_business(order_id), 'orders') or is_staff_ops());
create policy payments_sel on payments for select using (order_customer(order_id) = app_uid() or is_staff_ops());
create policy refunds_sel on refunds for select using (order_customer(order_id) = app_uid() or is_staff_ops());
-- loyalty
create policy ledger_sel on loyalty_ledger for select using (user_id = app_uid() or is_staff_ops());
-- notifications / devices
create policy notif_sel on notifications for select using (user_id = app_uid());
create policy notif_upd on notifications for update using (user_id = app_uid()) with check (user_id = app_uid());
create policy devices_own on device_tokens for all using (user_id = app_uid()) with check (user_id = app_uid());
-- moderation
create policy reports_sel on reports for select using (reporter_id = app_uid() or is_staff_ops());
create policy reports_ins on reports for insert with check (reporter_id = app_uid());
create policy reports_upd on reports for update using (is_staff_ops()) with check (is_staff_ops());
create policy disputes_sel on disputes for select
  using (opened_by = app_uid() or member_perm(order_business(order_id), 'orders') or is_staff_ops());
create policy disputes_ins on disputes for insert with check (opened_by = app_uid() and order_customer(order_id) = app_uid());
create policy disputes_upd on disputes for update using (is_staff_ops()) with check (is_staff_ops());
create policy dispute_ev_sel on dispute_events for select using (exists (select 1 from disputes d where d.id = dispute_id
  and (d.opened_by = app_uid() or is_staff_ops())));
create policy dispute_ev_ins on dispute_events for insert with check (actor_id = app_uid());
-- compliance
create policy export_sel on data_export_jobs for select using (user_id = app_uid());
create policy audit_sel on audit_logs for select using (is_admin());
create policy audit_ins on audit_logs for insert with check (actor_id = app_uid());
create policy analytics_ins on analytics_events for insert with check (user_id is null or user_id = app_uid());
create policy analytics_sel on analytics_events for select using (is_admin());

-- ── conversation / business guards ──
create function conv_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is null then return new; end if;   -- service role
  if new.customer_id <> old.customer_id or new.store_id <> old.store_id or new.business_id <> old.business_id then
    raise exception 'immutable conversation fields' using errcode = '42501';
  end if;
  if new.blocked_by_customer <> old.blocked_by_customer and old.customer_id <> app_uid() then
    raise exception 'only the customer can change this block' using errcode = '42501';
  end if;
  if new.blocked_by_business <> old.blocked_by_business and conv_side(old.id) <> 'business' then
    raise exception 'only the business can change this block' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger conv_guard_trg before update on conversations for each row execute function conv_guard();

create function msg_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger msg_after_insert_trg after insert on messages for each row execute function msg_after_insert();

-- Non-admins can only move a business draft/rejected -> pending and may not review themselves.
create function business_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is null or app_role() = 'admin' then return new; end if;
  if new.status <> old.status and not (old.status in ('draft','rejected') and new.status = 'pending') then
    raise exception 'status change requires administrator review' using errcode = '42501';
  end if;
  if new.owner_id <> old.owner_id or new.review_note is distinct from old.review_note
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'protected business fields' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger business_guard_trg before update on businesses for each row execute function business_guard();

-- ── grants (least privilege) ──
grant usage on schema public to yalasala_app, yalasala_service;
grant select, insert, update, delete on all tables in schema public to yalasala_service;
grant usage, select on all sequences in schema public to yalasala_app, yalasala_service;

grant select on all tables in schema public to yalasala_app;
revoke select on otp_codes, deletion_requests from yalasala_app;
grant insert, update, delete on
  addresses, products, product_alternatives, ready_baskets, ready_basket_items, stores, store_areas,
  saved_items, saved_baskets, device_tokens, areas, categories, packages, basket_rules
  to yalasala_app;
grant insert on consents, businesses, business_members, basket_generations, conversations, messages, attachments,
  reports, disputes, dispute_events, audit_logs, analytics_events to yalasala_app;
grant update (name_en, name_ar, trade_license_no, contact_phone, status) on businesses to yalasala_app;  -- package_id/review fields: service only
grant update on business_members, conversations, reports, disputes, basket_generations to yalasala_app;
grant delete on business_members to yalasala_app;
grant insert, update on conversation_reads to yalasala_app;
grant update (read_at) on notifications to yalasala_app;
grant update (name, email, locale, marketing_opt_in, preferences) on users to yalasala_app;
grant update on loyalty_rules to yalasala_app;
grant execute on all functions in schema public to yalasala_app, yalasala_service;
