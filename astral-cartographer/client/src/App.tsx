import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import Opening from './pages/Opening';
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import Home from './pages/Home';
import Placeholder from './pages/Placeholder';

const DependencyAtlas = lazy(() => import('./pages/DependencyAtlas'));
const OnboardingPathfinder = lazy(() => import('./pages/OnboardingPathfinder'));

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Opening />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route path="/home" element={<Home />} />
          <Route path="/atlas" element={<Suspense fallback={null}><DependencyAtlas /></Suspense>} />
          <Route path="/explorer" element={<Placeholder title="Code Explorer" subtitle="Browse, search, and understand your codebase." />} />
          <Route path="/health" element={<Placeholder title="Architectural Health" subtitle="Understand the health, risks, and structure of your codebase." />} />
          <Route path="/pathfinder" element={<Suspense fallback={null}><OnboardingPathfinder /></Suspense>} />
          <Route path="/reports" element={<Placeholder title="Reports & Benchmarks" subtitle="Get detailed insights about this repository." />} />
          <Route path="/settings" element={<Placeholder title="Settings" subtitle="Customize your experience and manage your repositories." />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
