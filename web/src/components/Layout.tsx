import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { useApp } from '../state/app';
import { useI18n } from '../i18n';
import { AreaPicker } from './AreaPicker';
import { Toaster } from './ui';
import { api } from '../lib/api';

export function Layout() {
  const { t, locale, setLocale, name } = useI18n();
  const { user, unread, msgUnread } = useAuth();
  const { config, area, basket, form, setAreaPickerOpen, online } = useApp();
  const loc = useLocation();
  // first visit: ask for the service area (manual entry is always possible; location is opt-in)
  useEffect(() => {
    try {
      if (!form.areaId && !localStorage.getItem('yalasala.areaAsked') && loc.pathname === '/') {
        localStorage.setItem('yalasala.areaAsked', '1');
        setAreaPickerOpen(true);
      }
    } catch {
      /* ignore */
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const count = basket?.items.reduce((s, i) => s + i.qty, 0) ?? 0;
  const test = config && (config.providers.otp.mode !== 'live' || config.providers.payments.mode !== 'live');
  const switchLang = () => {
    const n = locale === 'ar' ? 'en' : 'ar';
    setLocale(n);
    api('/analytics', { body: { name: 'language_switched', props: { to: n } } }).catch(() => undefined);
    if (user) api('/me', { method: 'PATCH', body: { locale: n } }).catch(() => undefined);
  };
  const dash =
    user?.role === 'merchant'
      ? { to: '/business', label: t('nav.merchant') }
      : user?.role === 'admin' || user?.role === 'support'
        ? { to: '/admin', label: t('nav.admin') }
        : null;
  return (
    <>
      <a href="#main" className="skip">
        {t('nav.skip')}
      </a>
      {test && (
        <div className="banner" role="note">
          {t('mode.banner')}
        </div>
      )}
      {!online && (
        <div className="banner" role="alert" style={{ background: '#7a4300' }}>
          {t('common.offline')}
        </div>
      )}
      <header className="header">
        <div className="container">
          <Link to="/" className="brand">
            <img src="/icon.svg" alt="" /> <span>{t('brand.name')}</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/stores">{t('nav.stores')}</NavLink>
            <NavLink to="/ready">{t('nav.ready')}</NavLink>
            {user && <NavLink to="/orders">{t('nav.orders')}</NavLink>}
            {user && <NavLink to="/loyalty">{t('nav.loyalty')}</NavLink>}
            <NavLink to="/help">{t('nav.help')}</NavLink>
            {dash && <NavLink to={dash.to}>{dash.label}</NavLink>}
          </nav>
          <div className="tools">
            <button className="pill" onClick={() => setAreaPickerOpen(true)} aria-label={t('area.change')}>
              📍 <span>{area ? name(area) : t('area.choose')}</span>
            </button>
            <button
              className="pill"
              onClick={switchLang}
              lang={locale === 'ar' ? 'en' : 'ar'}
              title="Switch language / تغيير اللغة"
            >
              {t('nav.language')}
            </button>
            <Link className="pill hide-mobile" to="/messages" aria-label={t('nav.messages')}>
              💬{msgUnread > 0 && <span className="badge-count">{msgUnread}</span>}
            </Link>
            <Link className="pill hide-mobile" to="/basket" aria-label={t('nav.basket')}>
              🧺{count > 0 && <span className="badge-count">{count}</span>}
            </Link>
            {user ? (
              <Link className="pill hide-mobile" to="/account" aria-label={t('nav.account')}>
                👤{unread > 0 && <span className="badge-count">{unread}</span>}
              </Link>
            ) : (
              <Link className="pill hide-mobile" to={`/signin?next=${encodeURIComponent(loc.pathname)}`}>
                {t('nav.signin')}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={loc.pathname === '/basket' ? 'has-minibar' : ''}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="footer">
        <div className="container stack">
          <div className="row">
            <Link to="/legal/terms">{t('footer.terms')}</Link>
            <Link to="/legal/privacy">{t('footer.privacy')}</Link>
            <Link to="/help">{t('nav.help')}</Link>
            <Link to="/signin">{t('footer.business')}</Link>
          </div>
          <div>
            {t('footer.coverage')} · {t('footer.contact')}
          </div>
          <div className="small">{t('footer.legal')}</div>
        </div>
      </footer>
      <nav className="bottom-nav" aria-label="Mobile">
        <NavLink to="/" end>
          <span className="ico" aria-hidden>
            🏠
          </span>
          {t('nav.home')}
        </NavLink>
        <NavLink to="/stores">
          <span className="ico" aria-hidden>
            🏪
          </span>
          {t('nav.stores')}
        </NavLink>
        <NavLink to="/basket">
          <span className="ico" aria-hidden>
            🧺
          </span>
          {t('nav.basket')}
          {count > 0 && (
            <span className="badge-count" style={{ position: 'absolute', top: 4, insetInlineEnd: '22%' }}>
              {count}
            </span>
          )}
        </NavLink>
        <NavLink to="/messages">
          <span className="ico" aria-hidden>
            💬
          </span>
          {t('nav.messages')}
          {msgUnread > 0 && (
            <span className="badge-count" style={{ position: 'absolute', top: 4, insetInlineEnd: '22%' }}>
              {msgUnread}
            </span>
          )}
        </NavLink>
        <NavLink to={user ? '/account' : '/signin'}>
          <span className="ico" aria-hidden>
            👤
          </span>
          {user ? t('nav.account') : t('nav.signin')}
        </NavLink>
      </nav>
      <AreaPicker />
      <Toaster />
    </>
  );
}
