import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { BACKGROUNDS } from '../lib/backgrounds';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, updatePassword } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  // Password reset form states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordUpdateSuccess, setPasswordUpdateSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    // Check URL parameters for OAuth errors and recovery mode
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const errorParam = params.get('error') || hashParams.get('error');
    const errorDesc = params.get('error_description') || hashParams.get('error_description');
    const typeParam = params.get('type') || hashParams.get('type');

    if (errorParam || errorDesc) {
      if (
        errorParam === 'access_denied' ||
        errorDesc?.toLowerCase().includes('denied') ||
        errorDesc?.toLowerCase().includes('cancelled')
      ) {
        setErrorMessage('Authentication was cancelled or access was denied. You can try signing in again anytime.');
      } else {
        setErrorMessage(errorDesc || errorParam || 'Authentication failed.');
      }
      return;
    }

    if (typeParam === 'recovery') {
      setIsRecoveryMode(true);
      return;
    }

    // Verify session for OAuth callback or email confirmation
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setErrorMessage(error.message);
      } else if (session) {
        // Clean URL hash so tokens aren't left in the browser address bar
        window.history.replaceState(null, '', window.location.pathname);
        const destination = sessionStorage.getItem('auth_redirect_to') || '/home';
        sessionStorage.removeItem('auth_redirect_to');
        navigate(destination, { replace: true });
      } else {
        // If session not yet processed, wait briefly for onAuthStateChange to capture
        const timer = setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: retrySession } }) => {
            if (retrySession) {
              window.history.replaceState(null, '', window.location.pathname);
              const destination = sessionStorage.getItem('auth_redirect_to') || '/home';
              sessionStorage.removeItem('auth_redirect_to');
              navigate(destination, { replace: true });
            } else {
              setErrorMessage('No active session found. Please try signing in again.');
            }
          });
        }, 1200);
        return () => clearTimeout(timer);
      }
    }).catch((err) => {
      setErrorMessage(err?.message || 'Authentication error occurred.');
    });
  }, [navigate]);

  useEffect(() => {
    // Only auto-redirect if we are not in recovery mode
    if (user && !isRecoveryMode) {
      const destination = sessionStorage.getItem('auth_redirect_to') || '/home';
      sessionStorage.removeItem('auth_redirect_to');
      navigate(destination, { replace: true });
    }
  }, [user, navigate, isRecoveryMode]);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match. Please verify both fields.');
      return;
    }

    setIsUpdatingPassword(true);
    const { error } = await updatePassword(newPassword);
    setIsUpdatingPassword(false);

    if (error) {
      setPasswordError(error.message);
    } else {
      setPasswordUpdateSuccess(true);
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => {
        navigate('/home', { replace: true });
      }, 1500);
    }
  };

  const bg = BACKGROUNDS[2];

  return (
    <div
      className="auth-page"
      style={{ backgroundImage: `url(${bg.url})` }}
    >
      <Link
        to="/auth"
        style={{
          position: 'absolute',
          top: 24,
          left: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          color: '#B8BBCB',
          fontSize: 13,
          zIndex: 10,
          background: 'rgba(7, 12, 27, 0.65)',
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid rgba(135, 155, 255, 0.18)',
          backdropFilter: 'blur(10px)',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={16} /> Return to Sign In
      </Link>

      <div
        className="auth-card"
        style={{
          maxWidth: 440,
          margin: '0 auto',
          textAlign: isRecoveryMode ? 'left' : 'center',
          alignItems: isRecoveryMode ? 'stretch' : 'center',
        }}
      >
        {isRecoveryMode ? (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 className="auth-title" style={{ fontSize: 20 }}>Choose New Password</h2>
              <p className="auth-subtitle" style={{ marginTop: 6 }}>
                Set a new password for your Astral Cartographer account.
              </p>
            </div>

            {passwordError && (
              <div
                style={{
                  background: 'rgba(255, 113, 122, 0.12)',
                  border: '1px solid rgba(255, 113, 122, 0.3)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#FF949C',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{passwordError}</span>
              </div>
            )}

            {passwordUpdateSuccess ? (
              <div
                style={{
                  background: 'rgba(67, 217, 163, 0.12)',
                  border: '1px solid rgba(67, 217, 163, 0.3)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  color: '#70E8BA',
                  textAlign: 'left',
                }}
              >
                <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                <span>Password updated successfully! Redirecting you to your star charts...</span>
              </div>
            ) : (
              <form onSubmit={handlePasswordUpdate}>
                <div className="auth-field" style={{ marginBottom: 14 }}>
                  <div className="auth-input-wrapper">
                    <span className="auth-input-icon">
                      <Lock size={16} />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      disabled={isUpdatingPassword}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (min 6 chars)"
                      className="auth-input has-left-icon has-right-icon"
                    />
                    <button
                      type="button"
                      className="auth-input-eye"
                      disabled={isUpdatingPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="auth-field" style={{ marginBottom: 20 }}>
                  <div className="auth-input-wrapper">
                    <span className="auth-input-icon">
                      <Lock size={16} />
                    </span>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      disabled={isUpdatingPassword}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="auth-input has-left-icon has-right-icon"
                    />
                    <button
                      type="button"
                      className="auth-input-eye"
                      disabled={isUpdatingPassword}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={isUpdatingPassword}
                  style={{ width: '100%' }}
                >
                  {isUpdatingPassword ? 'Updating Password...' : 'Save New Password'}
                </button>
              </form>
            )}
          </div>
        ) : errorMessage ? (
          <>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(255, 113, 122, 0.15)',
                border: '1px solid rgba(255, 113, 122, 0.4)',
                display: 'grid',
                placeItems: 'center',
                color: '#FF717A',
                fontSize: 22,
                marginBottom: 16,
              }}
            >
              ✕
            </div>
            <h2 className="auth-title" style={{ fontSize: 20 }}>Authentication Issue</h2>
            <p className="auth-subtitle" style={{ color: '#FF949C', margin: '10px 0 24px' }}>
              {errorMessage}
            </p>
            <Link to="/auth" className="primary-button" style={{ width: '100%', textDecoration: 'none' }}>
              Return to Sign In
            </Link>
          </>
        ) : (
          <>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '2px solid rgba(139, 120, 255, 0.2)',
                borderTopColor: '#8B78FF',
                animation: 'spin 1s linear infinite',
                boxShadow: '0 0 20px rgba(139, 120, 255, 0.35)',
                marginBottom: 20,
              }}
            />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <h2 className="auth-title" style={{ fontSize: 18 }}>Authenticating Session...</h2>
            <p className="auth-subtitle">
              Synchronizing your credentials with The Astral Cartographer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

