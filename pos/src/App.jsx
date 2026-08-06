import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import RoutePlanning from './pages/RoutePlanning';
import BulkImport from './pages/BulkImport';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/routes" replace />} />
          <Route path="routes" element={<RoutePlanning />} />
          <Route path="import" element={<BulkImport />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
