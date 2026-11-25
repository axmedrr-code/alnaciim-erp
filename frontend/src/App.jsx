import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
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
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="production" element={<ProductionPage />} />
              <Route path="sales" element={<SalesPage />} />
              <Route path="procurement" element={<ProcurementPage />} />
              <Route path="requisitions" element={<RequisitionsPage />} />
              <Route path="operations" element={<OperationsDashboard />} />
              <Route path="logistics" element={<LogisticsExceptionsPage />} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="driver" element={<DriverPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}
