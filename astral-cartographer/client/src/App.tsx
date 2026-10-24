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
const CodeExplorer = lazy(() => import('./pages/CodeExplorer'));
const ArchitecturalHealth = lazy(() => import('./pages/ArchitecturalHealth'));
const OnboardingPathfinder = lazy(() => import('./pages/OnboardingPathfinder'));
const ReportsBenchmarks = lazy(() => import('./pages/ReportsBenchmarks'));

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
          <Route path="/explorer" element={<Suspense fallback={null}><CodeExplorer /></Suspense>} />
          <Route path="/health" element={<Suspense fallback={null}><ArchitecturalHealth /></Suspense>} />
          <Route path="/pathfinder" element={<Suspense fallback={null}><OnboardingPathfinder /></Suspense>} />
          <Route path="/reports" element={<Suspense fallback={null}><ReportsBenchmarks /></Suspense>} />
          <Route path="/settings" element={<Placeholder title="Settings" subtitle="Customize your experience and manage your repositories." />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
