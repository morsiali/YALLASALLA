-- Yalasala UAE — core schema. Money is integer fils (1 AED = 100 fils), currency is explicit.
-- All timestamps are timestamptz. Enumerations are text + CHECK to keep migrations simple.

create function app_uid() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────────────────────── identity ─────────────────────────
create table users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+9715[0-9]{8}$'),
  email text,
  name text,
  role text not null default 'customer' check (role in ('customer','merchant','admin','support')),
  locale text not null default 'ar' check (locale in ('ar','en')),
  status text not null default 'active' check (status in ('active','restricted','deleted')),
  marketing_opt_in boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,   -- stored dietary / brand / tier preferences
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_codes_phone_idx on otp_codes (phone, created_at desc);

create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('location','transcription','marketing','personalization','terms')),
  granted boolean not null,
  created_at timestamptz not null default now()
);
create index consents_user_idx on consents (user_id, kind, created_at desc);

-- ───────────────────────── geography ─────────────────────────
create table areas (
  id uuid primary key default gen_random_uuid(),
  emirate text not null,
  name_en text not null,
  name_ar text not null,
  lat numeric(9,6),
  lng numeric(9,6),
  unique (emirate, name_en)
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  area_id uuid not null references areas(id),
  label text not null default 'Home',
  building text not null,
  unit text,
  instructions text,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on addresses (user_id);

-- ───────────────────────── packages & businesses ─────────────────────────
create table packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_en text not null,
  name_ar text not null,
  price_minor int not null check (price_minor >= 0),
  currency char(3) not null default 'AED',
  billing_interval text not null check (billing_interval in ('month','year')),
  trial_days int not null default 0 check (trial_days >= 0),
  -- entitlements: max_products, max_ready_baskets, staff_seats, messages_per_day, analytics ('basic'|'advanced'), max_stores
  entitlements jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name_en text not null,
  name_ar text not null,
  trade_license_no text,
  contact_phone text,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','suspended')),
  review_note text,
  package_id uuid references packages(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index businesses_owner_idx on businesses (owner_id);

create table business_members (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  member_role text not null check (member_role in ('owner','staff')),
  permissions text[] not null default '{}',   -- subset of catalog, orders, conversations, reports
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on business_members (user_id);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  package_id uuid not null references packages(id),
  status text not null check (status in ('trial','active','past_due','cancelled')),
  trial_ends_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index subscriptions_business_idx on subscriptions (business_id, started_at desc);

create table stores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name_en text not null,
  name_ar text not null,
  description_en text,
  description_ar text,
  phone text,
  cover_image text,
  opening_hours jsonb not null default '{"open":"08:00","close":"23:00"}'::jsonb,
  delivery_fee_minor int not null default 1000 check (delivery_fee_minor >= 0),
  free_delivery_over_minor int check (free_delivery_over_minor is null or free_delivery_over_minor > 0),
  min_order_minor int not null default 0 check (min_order_minor >= 0),
  eta_min_minutes int not null default 60,
  eta_max_minutes int not null default 120,
  accepts_cod boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (eta_max_minutes >= eta_min_minutes)
);
create index stores_business_idx on stores (business_id);

create table store_areas (
  store_id uuid not null references stores(id) on delete cascade,
  area_id uuid not null references areas(id),
  primary key (store_id, area_id)
);
create index store_areas_area_idx on store_areas (area_id);

-- ───────────────────────── catalog ─────────────────────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  need_group text not null check (need_group in
    ('essentials','breakfast_dairy','protein','fruits_veg','beverages','cleaning','personal_care','baby_family','optional')),
  name_en text not null,
  name_ar text not null,
  sort_order int not null default 0
);

create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid not null references categories(id),
  sku text not null,
  name_en text not null,
  name_ar text not null,
  brand text not null,
  description_en text,
  description_ar text,
  size_label text not null,
  price_minor int not null check (price_minor > 0),
  compare_at_minor int check (compare_at_minor is null or compare_at_minor > price_minor), -- real offers only
  currency char(3) not null default 'AED',
  stock_qty int not null default 0 check (stock_qty >= 0),
  image_url text,
  tier text not null default 'standard' check (tier in ('value','standard','premium')),
  dietary text[] not null default '{}',   -- halal, vegetarian, gluten_free, organic, low_sugar, high_protein, baby_safe
  allergens text[] not null default '{}', -- nuts, dairy, gluten, eggs, soy, fish
  country_of_origin text,
  substitutable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, sku)
);
create index products_store_cat_idx on products (store_id, category_id) where active;
create index products_search_idx on products using gin (to_tsvector('simple', name_en || ' ' || name_ar || ' ' || brand));

create table product_alternatives (   -- merchant-mapped substitution rules
  product_id uuid not null references products(id) on delete cascade,
  alternative_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, alternative_id),
  check (product_id <> alternative_id)
);

-- Admin-configurable household quantity rules (units = packs of the product's listed size)
create table basket_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null unique references categories(id),
  units_per_person_week numeric(6,2) not null check (units_per_person_week > 0),
  priority text not null check (priority in ('essential','standard','optional')),
  min_units int not null default 1 check (min_units >= 0),
  max_units int not null default 20 check (max_units >= min_units),
  requires_flag text check (requires_flag in ('baby')),   -- only included when the flag is set
  high_protein_boost numeric(4,2) not null default 1.0,
  active boolean not null default true
);

create table ready_baskets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  code text not null,
  basket_type text not null check (basket_type in ('family_weekly','budget','single','monthly','baby','healthy')),
  name_en text not null,
  name_ar text not null,
  description_en text,
  description_ar text,
  household_size int not null check (household_size between 1 and 12),
  duration_days int not null check (duration_days between 1 and 62),
  active boolean not null default true,
  unique (store_id, code)
);
create table ready_basket_items (
  ready_basket_id uuid not null references ready_baskets(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty int not null check (qty > 0),
  primary key (ready_basket_id, product_id)
);

-- ───────────────────────── baskets (engine output, analytics) ─────────────────────────
create table basket_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,   -- null for guests
  store_id uuid references stores(id),
  source text not null check (source in ('guided','natural','ready','repeat','voice')),
  engine text not null check (engine in ('rules','ai+rules')),
  fallback_used boolean not null default false,
  constraints jsonb not null,
  result jsonb not null,           -- items, totals, facts (decision facts)
  corrected_by_user boolean not null default false,
  created_at timestamptz not null default now()
);
create index basket_generations_user_idx on basket_generations (user_id, created_at desc);

create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('store','product','ready_basket')),
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);
create table saved_baskets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  store_id uuid not null references stores(id),
  items jsonb not null,            -- [{productId, qty}]
  constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── messaging ─────────────────────────
create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id) on delete cascade,
  customer_name text,                -- first-name snapshot so merchants never need to read users
  store_id uuid not null references stores(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  blocked_by_customer boolean not null default false,
  blocked_by_business boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (customer_id, store_id)
);
create index conversations_business_idx on conversations (business_id, last_message_at desc);
create index conversations_customer_idx on conversations (customer_id, last_message_at desc);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  uploader_id uuid not null references users(id),
  kind text not null check (kind in ('image','voice')),
  mime text not null,
  bytes int not null check (bytes > 0),
  storage_key text not null,
  duration_ms int,
  retention_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid references users(id),
  sender_side text not null check (sender_side in ('customer','business','system')),
  kind text not null check (kind in ('text','image','voice','reference','substitution','system')),
  body text check (body is null or length(body) <= 4000),
  attachment_id uuid references attachments(id),
  ref_type text check (ref_type in ('product','store','basket','order','ready_basket')),
  ref_id uuid,
  ref_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index messages_conv_idx on messages (conversation_id, created_at desc, id);

create table conversation_reads (
  conversation_id uuid not null references conversations(id) on delete cascade,
  side text not null check (side in ('customer','business')),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, side)
);

create table transcriptions (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references attachments(id) on delete cascade,
  requested_by uuid not null references users(id),
  language text not null check (language in ('ar','en','auto')),
  detected_language text,
  status text not null check (status in ('done','failed')),
  provider_mode text not null check (provider_mode in ('mock','sandbox','live')),
  faithful_text text,
  readable_text text,
  uncertain_words jsonb not null default '[]'::jsonb,   -- [{word, start, end}]
  error text,
  retention_until timestamptz not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── orders ─────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity (start with 100001),
  customer_id uuid not null references users(id),
  store_id uuid not null references stores(id),
  business_id uuid not null references businesses(id),
  status text not null check (status in ('pending_payment','received','reviewing','preparing','ready',
    'out_for_delivery','delivered','cancelled','rejected')),
  subtotal_minor int not null check (subtotal_minor >= 0),
  discount_minor int not null default 0 check (discount_minor >= 0),
  delivery_fee_minor int not null check (delivery_fee_minor >= 0),
  loyalty_redeemed_minor int not null default 0 check (loyalty_redeemed_minor >= 0),
  loyalty_points_redeemed int not null default 0 check (loyalty_points_redeemed >= 0),
  total_minor int not null check (total_minor >= 0),
  currency char(3) not null default 'AED',
  budget_minor int,
  budget_includes_delivery boolean,
  budget_status text not null check (budget_status in ('none','within','close','over','over_approved')),
  substitution_policy text not null check (substitution_policy in ('auto','ask','none')),
  constraints jsonb not null default '{}'::jsonb,
  address jsonb not null,           -- snapshot at order time
  notes text,
  payment_method text not null check (payment_method in ('cod','sandbox_card')),
  payment_status text not null check (payment_status in ('pending','paid','failed','refunded','cod_due')),
  idempotency_key text not null,
  generation_id uuid references basket_generations(id),
  reorder_of uuid references orders(id),
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key),
  check (total_minor = subtotal_minor - discount_minor + delivery_fee_minor - loyalty_redeemed_minor)
);
create index orders_customer_idx on orders (customer_id, placed_at desc);
create index orders_business_idx on orders (business_id, status, placed_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  name_en text not null,
  name_ar text not null,
  brand text not null,
  size_label text not null,
  qty int not null check (qty > 0),
  unit_price_minor int not null check (unit_price_minor > 0),
  line_total_minor int not null check (line_total_minor = qty * unit_price_minor),
  status text not null default 'ok' check (status in ('ok','unavailable','substituted','removed')),
  replaces_item_id uuid references order_items(id),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on order_items (order_id);

create table order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on order_status_history (order_id, id);

create table substitution_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  original_product_id uuid not null references products(id),
  proposed_product_id uuid references products(id),      -- null = no suitable substitute
  proposed_qty int,
  reason text,
  price_diff_minor int,                                  -- new line total - old line total
  differences jsonb not null default '[]'::jsonb,        -- brand / size / dietary differences
  status text not null check (status in ('pending','accepted','rejected','auto_applied','expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);
create index substitution_requests_order_idx on substitution_requests (order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  mode text not null check (mode in ('mock','sandbox','live','cash')),
  provider_ref text,
  status text not null check (status in ('pending','succeeded','failed','refunded')),
  amount_minor int not null check (amount_minor >= 0),
  currency char(3) not null default 'AED',
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table payment_events (            -- webhook idempotency
  event_id text primary key,
  payment_id uuid references payments(id),
  payload_hash text not null,
  received_at timestamptz not null default now()
);
create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  payment_id uuid references payments(id),
  amount_minor int not null check (amount_minor > 0),
  reason text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── loyalty (append-only ledger) ─────────────────────────
create table loyalty_rules (
  id smallint primary key default 1 check (id = 1),     -- single active rule-set row
  earn_points_per_aed numeric(6,2) not null default 1,
  hold_days int not null default 3,                       -- points are pending until delivered + hold_days
  point_value_minor int not null default 1,               -- 1 point = 1 fils (100 points = AED 1)
  min_redeem_points int not null default 500,
  max_redeem_pct_of_subtotal int not null default 20 check (max_redeem_pct_of_subtotal between 0 and 100),
  expiry_days int not null default 365,
  daily_earn_cap_points int not null default 5000,
  updated_at timestamptz not null default now()
);

create table loyalty_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id),
  order_id uuid references orders(id),
  kind text not null check (kind in ('earn','redeem','redeem_reversal','earn_reversal','expire','adjust')),
  points int not null check (points <> 0),
  available_at timestamptz not null default now(),        -- earn entries are pending until this time
  reverses_id bigint references loyalty_ledger(id),
  reason text not null,
  created_by uuid references users(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index loyalty_ledger_user_idx on loyalty_ledger (user_id, id desc);

-- ───────────────────────── notifications, moderation, compliance ─────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null check (platform in ('web','android','ios')),
  token text not null,
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id),
  target_type text not null check (target_type in ('conversation','message','store','product','order')),
  target_id uuid not null,
  reason text not null check (length(reason) between 3 and 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  resolution text,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  opened_by uuid not null references users(id),
  reason text not null check (length(reason) between 3 and 2000),
  status text not null default 'open' check (status in ('open','under_review','resolved','rejected')),
  resolution text,
  refund_minor int check (refund_minor is null or refund_minor >= 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table dispute_events (
  id bigint generated always as identity primary key,
  dispute_id uuid not null references disputes(id) on delete cascade,
  actor_id uuid references users(id),
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

create table data_export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('ready','failed')),
  payload jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null check (status in ('completed','blocked')),
  note text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id text,
  reason text,
  detail jsonb not null default '{}'::jsonb,   -- never contains message bodies, tokens or card data
  created_at timestamptz not null default now()
);
create index audit_logs_idx on audit_logs (created_at desc);

create table analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index analytics_events_name_idx on analytics_events (name, created_at desc);

-- ───────────────────────── integrity triggers ─────────────────────────
create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;

create trigger loyalty_ledger_append_only before update or delete on loyalty_ledger
  for each row execute function forbid_mutation();
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function forbid_mutation();
create trigger order_history_append_only before update or delete on order_status_history
  for each row execute function forbid_mutation();

-- Allowed order transitions are enforced in the database, not just the API.
create function order_transition_ok(f text, t text) returns boolean language sql immutable as $$
  select (f, t) in (
    ('pending_payment','received'), ('pending_payment','cancelled'),
    ('received','reviewing'), ('received','rejected'), ('received','cancelled'),
    ('reviewing','preparing'), ('reviewing','rejected'), ('reviewing','cancelled'),
    ('preparing','ready'), ('preparing','cancelled'),
    ('ready','out_for_delivery'), ('ready','cancelled'),
    ('out_for_delivery','delivered'), ('out_for_delivery','cancelled'))
$$;

create function orders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into order_status_history(order_id, from_status, to_status, actor_id)
      values (new.id, null, new.status, app_uid());
    return new;
  end if;
  if new.status <> old.status then
    if not order_transition_ok(old.status, new.status) then
      raise exception 'invalid order transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    insert into order_status_history(order_id, from_status, to_status, actor_id)
      values (new.id, old.status, new.status, app_uid());
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger orders_guard_ins after insert on orders for each row execute function orders_guard();
create trigger orders_guard_upd before update on orders for each row execute function orders_guard();
