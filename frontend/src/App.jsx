import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import RoleRoute from './components/RoleRoute';
import NotFound from './components/NotFound';
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'));
const ProductionPage = lazy(() => import('./pages/production/ProductionPage'));
const SalesPage = lazy(() => import('./pages/sales/SalesPage'));
const ProcurementPage = lazy(() => import('./pages/procurement/ProcurementPage'));
const MaintenancePage = lazy(() => import('./pages/maintenance/MaintenancePage'));
const FinancePage = lazy(() => import('./pages/finance/FinancePage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const DriverPage = lazy(() => import('./pages/driver/DriverPage'));
const RequisitionsPage = lazy(() => import('./pages/procurement/RequisitionsPage'));
const OperationsDashboard = lazy(() => import('./pages/OperationsDashboard'));
const LogisticsExceptionsPage = lazy(() => import('./pages/LogisticsExceptionsPage'));
const TankerLoadingPage = lazy(() => import('./pages/TankerLoadingPage'));
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'));

function Home() {
  const { user } = useAuth();
  return user?.role === 'Driver' ? <Navigate to="/driver" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Suspense fallback={<div className="page-loading" style={{ padding: 28, textAlign: 'center' }}>Loading module…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Home />} />
              <Route path="inventory" element={<RoleRoute path="/inventory"><InventoryPage /></RoleRoute>} />
              <Route path="production" element={<RoleRoute path="/production"><ProductionPage /></RoleRoute>} />
              <Route path="sales" element={<RoleRoute path="/sales"><SalesPage /></RoleRoute>} />
              <Route path="procurement" element={<RoleRoute path="/procurement"><ProcurementPage /></RoleRoute>} />
              <Route path="requisitions" element={<RoleRoute path="/requisitions"><RequisitionsPage /></RoleRoute>} />
              <Route path="operations" element={<RoleRoute path="/operations"><OperationsDashboard /></RoleRoute>} />
              <Route path="logistics" element={<RoleRoute path="/logistics"><LogisticsExceptionsPage /></RoleRoute>} />
              <Route path="tanker-loading" element={<RoleRoute path="/tanker-loading"><TankerLoadingPage /></RoleRoute>} />
              <Route path="collections" element={<RoleRoute path="/collections"><CollectionsPage /></RoleRoute>} />
              <Route path="maintenance" element={<RoleRoute path="/maintenance"><MaintenancePage /></RoleRoute>} />
              <Route path="finance" element={<RoleRoute path="/finance"><FinancePage /></RoleRoute>} />
              <Route path="reports" element={<RoleRoute path="/reports"><ReportsPage /></RoleRoute>} />
              <Route path="settings" element={<RoleRoute path="/settings"><SettingsPage /></RoleRoute>} />
              <Route path="driver" element={<RoleRoute path="/driver"><DriverPage /></RoleRoute>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}
