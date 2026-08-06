import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InventoryPage from './pages/inventory/InventoryPage';
import ProductionPage from './pages/production/ProductionPage';
import SalesPage from './pages/sales/SalesPage';
import ProcurementPage from './pages/procurement/ProcurementPage';
import MaintenancePage from './pages/maintenance/MaintenancePage';
import FinancePage from './pages/finance/FinancePage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import DriverPage from './pages/driver/DriverPage';

function Home() {
  const { user } = useAuth();
  return user?.role === 'Driver' ? <Navigate to="/driver" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
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
            <Route path="maintenance" element={<MaintenancePage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="driver" element={<DriverPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
