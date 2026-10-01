import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SkeletonList } from './components/ui';
import { useAuth } from './state/auth';
import Home from './pages/customer/Home';
import Builder from './pages/customer/Builder';
import BasketPage from './pages/customer/BasketPage';
import { ReadyDetail, ReadyList } from './pages/customer/Ready';
import { ProductPage, StorePage, StoresPage } from './pages/customer/Stores';
import { ConversationList, ConversationPage } from './pages/customer/Chat';
import Checkout from './pages/customer/Checkout';
import { OrderPage, OrdersList, RepeatPage } from './pages/customer/Orders';
import { AccountPage, HelpPage, LegalPage, LoyaltyPage, SavedPage } from './pages/customer/Account';
import { SignIn } from './pages/customer/Auth';

const M = <K extends keyof typeof import('./pages/merchant/Merchant')>(k: K) =>
  lazy(() => import('./pages/merchant/Merchant').then((m) => ({ default: m[k] as any })));
const A = <K extends keyof typeof import('./pages/admin/Admin')>(k: K) =>
  lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m[k] as any })));
const MerchantLayout = M('MerchantLayout'),
  MDashboard = M('MDashboard'),
  MOrders = M('MOrders'),
  MOrderDetail = M('MOrderDetail'),
  MCatalog = M('MCatalog'),
  MReady = M('MReady'),
  MReports = M('MReports'),
  MStaff = M('MStaff'),
  MPackage = M('MPackage'),
  MStore = M('MStore');
const AdminLayout = A('AdminLayout'),
  ADashboard = A('ADashboard'),
  AMerchants = A('AMerchants'),
  APackages = A('APackages'),
  AAreas = A('AAreas'),
  ARules = A('ARules'),
  ALoyalty = A('ALoyalty'),
  AOrders = A('AOrders'),
  ADisputes = A('ADisputes'),
  AUsers = A('AUsers'),
  AAudit = A('AAudit'),
  AProviders = A('AProviders');

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <SkeletonList n={2} />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <SkeletonList n={3} />
        </div>
      }
    >
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="build" element={<Builder />} />
          <Route path="basket" element={<BasketPage />} />
          <Route path="ready" element={<ReadyList />} />
          <Route path="ready/:id" element={<ReadyDetail />} />
          <Route path="stores" element={<StoresPage />} />
          <Route path="stores/:id" element={<StorePage />} />
          <Route path="products/:id" element={<ProductPage />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="signin" element={<SignIn />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="legal/:kind" element={<LegalPage />} />
          <Route
            path="messages"
            element={
              <RequireAuth>
                <ConversationList />
              </RequireAuth>
            }
          />
          <Route
            path="messages/:id"
            element={
              <RequireAuth>
                <ConversationPage />
              </RequireAuth>
            }
          />
          <Route
            path="orders"
            element={
              <RequireAuth>
                <OrdersList />
              </RequireAuth>
            }
          />
          <Route
            path="orders/:id"
            element={
              <RequireAuth>
                <OrderPage />
              </RequireAuth>
            }
          />
          <Route
            path="orders/:id/repeat"
            element={
              <RequireAuth>
                <RepeatPage />
              </RequireAuth>
            }
          />
          <Route
            path="loyalty"
            element={
              <RequireAuth>
                <LoyaltyPage />
              </RequireAuth>
            }
          />
          <Route
            path="saved"
            element={
              <RequireAuth>
                <SavedPage />
              </RequireAuth>
            }
          />
          <Route
            path="account"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route
            path="business"
            element={
              <RequireAuth>
                <MerchantLayout />
              </RequireAuth>
            }
          >
            <Route index element={<MDashboard />} />
            <Route path="orders" element={<MOrders />} />
            <Route path="orders/:id" element={<MOrderDetail />} />
            <Route path="catalog" element={<MCatalog />} />
            <Route path="ready" element={<MReady />} />
            <Route path="messages" element={<ConversationList base="/business/messages" />} />
            <Route path="messages/:id" element={<ConversationPage side="business" />} />
            <Route path="reports" element={<MReports />} />
            <Route path="staff" element={<MStaff />} />
            <Route path="package" element={<MPackage />} />
            <Route path="store" element={<MStore />} />
          </Route>
          <Route
            path="admin"
            element={
              <RequireAuth>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<ADashboard />} />
            <Route path="merchants" element={<AMerchants />} />
            <Route path="orders" element={<AOrders />} />
            <Route path="disputes" element={<ADisputes />} />
            <Route path="users" element={<AUsers />} />
            <Route path="packages" element={<APackages />} />
            <Route path="areas" element={<AAreas />} />
            <Route path="rules" element={<ARules />} />
            <Route path="loyalty" element={<ALoyalty />} />
            <Route path="audit" element={<AAudit />} />
            <Route path="providers" element={<AProviders />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
