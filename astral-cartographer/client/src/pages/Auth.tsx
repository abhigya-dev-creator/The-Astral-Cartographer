import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  GitFork,
  Sparkles,
  Compass,
  Network,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Info,
  X,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { BACKGROUNDS } from '../lib/backgrounds';
import { useAuth } from '../context/AuthContext';
import { getMissingSupabaseConfigInstructions } from '../lib/supabase';

// Helper error classification functions
const isUnconfirmedEmail = (msg: string | null): boolean => {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return l.includes('email not confirmed') || l.includes('email_not_confirmed');
};

const isUserAlreadyRegistered = (msg: string | null): boolean => {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return (
    l.includes('user already registered') ||
    l.includes('already exists') ||
    l.includes('already registered')
  );
};

const isInvalidCredentials = (msg: string | null): boolean => {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return (
    l.includes('invalid login credentials') ||
    l.includes('invalid credentials')
  );
};

const isRateLimit = (msg: string | null): boolean => {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return (
    l.includes('over_email_send_rate_limit') ||
    l.includes('rate limit') ||
    l.includes('too many requests') ||
    l.includes('security purposes')
  );
};

export default function Auth() {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<'github' | 'google' | 'email' | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Resend verification states
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Password reset modal states
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetCooldown, setResetCooldown] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const bg = BACKGROUNDS[2];

  const {
    user,
    signInWithGithub,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    resendVerification,
    isConfigured,
  } = useAuth();

  // Intended destination after authentication
  const destination = (location.state as any)?.from?.pathname || sessionStorage.getItem('auth_redirect_to') || '/home';

  // If already authenticated, redirect to destination
  useEffect(() => {
    if (user) {
      sessionStorage.removeItem('auth_redirect_to');
      navigate(destination, { replace: true });
    }
  }, [user, navigate, destination]);

  // Handle countdown timers
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setInterval(() => {
      setResetCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resetCooldown]);

  // Persist intended destination before external OAuth redirect
  const saveRedirectDestination = () => {
    const fromPath = (location.state as any)?.from?.pathname;
    if (fromPath && fromPath !== '/auth' && fromPath !== '/auth/callback') {
      sessionStorage.setItem('auth_redirect_to', fromPath);
    }
  };

  const handleGithubLogin = async () => {
    setLocalError(null);
    setSuccessMessage(null);
    setIsLoading(true);
    setLoadingProvider('github');
    saveRedirectDestination();

    const { error: err } = await signInWithGithub();
    if (err) {
      setLocalError(err.message);
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const handleGoogleLogin = async () => {
    setLocalError(null);
    setSuccessMessage(null);
    setIsLoading(true);
    setLoadingProvider('google');
    saveRedirectDestination();

    const { error: err } = await signInWithGoogle();
    if (err) {
      setLocalError(err.message);
      setIsLoading(false);
      setLoadingProvider(null);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      setLocalError('Please enter your email address to receive a verification link.');
      return;
    }
    setIsResending(true);
    const { error: err } = await resendVerification(targetEmail);
    setIsResending(false);

    if (err) {
      if (isRateLimit(err.message)) {
        setLocalError('Too many email requests. Please wait 60 seconds before requesting another verification email.');
      } else {
        setLocalError(err.message);
      }
    } else {
      setLocalError(null);
      setSuccessMessage(`A fresh verification link has been sent to ${targetEmail}. Please check your inbox and spam folder.`);
      setResendCooldown(60);
    }
  };

  const handleOpenResetModal = () => {
    setResetEmail(email.trim());
    setResetError(null);
    setResetSuccess(null);
    setShowResetModal(true);
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetSuccess(null);

    const targetEmail = resetEmail.trim();
    if (!targetEmail) {
      setResetError('Please enter your email address.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      setResetError('Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    setIsResetting(true);
    const { error: err } = await resetPassword(targetEmail);
    setIsResetting(false);

    if (err) {
      if (isRateLimit(err.message)) {
        setResetError('Too many password reset requests. Please wait 60 seconds before trying again.');
      } else {
        setResetError(err.message);
      }
    } else {
      setResetSuccess(`Password recovery link sent to ${targetEmail}! Check your inbox and spam folder.`);
      setResetCooldown(60);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);

    // Input Hygiene & Client-side Validation
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!navigator.onLine) {
      setLocalError('You appear to be offline. Please verify your internet connection.');
      return;
    }

    if (!trimmedEmail) {
      setLocalError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setLocalError('Please enter a valid email address (e.g. explorer@domain.com).');
      return;
    }

    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters long.');
      return;
    }

    if (tab === 'signup') {
      if (!agreeTerms) {
        setLocalError('You must agree to the Terms of Service & Privacy Policy to create an account.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match. Please verify both password entries.');
        return;
      }
    }

    setIsLoading(true);
    setLoadingProvider('email');

    if (tab === 'signin') {
      const { error: err } = await signInWithEmail(trimmedEmail, password);
      if (err) {
        setLocalError(err.message);
        setIsLoading(false);
        setLoadingProvider(null);
      } else {
        sessionStorage.removeItem('auth_redirect_to');
        navigate(destination, { replace: true });
      }
    } else {
      const { error: err, data } = await signUpWithEmail(trimmedEmail, password, trimmedName);
      if (err) {
        setLocalError(err.message);
        setIsLoading(false);
        setLoadingProvider(null);
      } else if (data?.session) {
        sessionStorage.removeItem('auth_redirect_to');
        navigate(destination, { replace: true });
      } else {
        setIsLoading(false);
        setLoadingProvider(null);
        setSuccessMessage(`Account created for ${trimmedEmail}! Please check your email inbox to verify your address before signing in.`);
      }
    }
  };

  const getFriendlyErrorMessage = (msg: string | null): string => {
    if (!msg) return '';
    if (isUnconfirmedEmail(msg)) {
      return 'Your email address has not been confirmed yet. Please verify your email using the link sent to your inbox.';
    }
    if (isUserAlreadyRegistered(msg)) {
      return 'An account with this email address already exists. Would you like to sign in instead?';
    }
    if (isInvalidCredentials(msg)) {
      return 'Invalid email or password. Please verify your credentials or click "Forgot password?" below.';
    }
    if (isRateLimit(msg)) {
      return 'Too many attempts. For security reasons, please wait about a minute before trying again.';
    }
    if (msg.toLowerCase().includes('failed to fetch')) {
      return 'Unable to reach the authentication service. Please check your internet connection.';
    }
    return msg;
  };

  return (
    <div
      className="auth-page"
      style={{ backgroundImage: `url(${bg.url})` }}
    >
      {/* Back to Opening screen */}
      <Link
        to="/"
        style={{
          position: 'absolute',
          top: 24,
          left: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          color: '#B8BBCB',
          fontSize: 13,
          fontWeight: 400,
          zIndex: 10,
          background: 'rgba(7, 12, 27, 0.65)',
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid rgba(135, 155, 255, 0.18)',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.16s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#EAF0FF';
          e.currentTarget.style.borderColor = 'rgba(135, 155, 255, 0.35)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#B8BBCB';
          e.currentTarget.style.borderColor = 'rgba(135, 155, 255, 0.18)';
        }}
      >
        <ArrowLeft size={16} /> Opening Scene
      </Link>

      <div className="auth-container">
        {/* Left Column: Brand & Feature Highlights */}
        <div className="auth-branding">
          <div className="auth-brand-the">THE</div>
          <div className="auth-brand-astral">ASTRAL</div>
          <div className="auth-brand-carto">CARTOGRAPHER</div>

          <div className="auth-tagline">
            Discover the connections hidden in your code.
          </div>

          <div className="auth-features">
            <div className="auth-feature-item">
              <div className="auth-feature-icon">
                <Network size={17} />
              </div>
              <span>Visualize codebases</span>
            </div>

            <div className="auth-feature-item">
              <div className="auth-feature-icon">
                <GitFork size={17} />
              </div>
              <span>Understand dependencies</span>
            </div>

            <div className="auth-feature-item">
              <div className="auth-feature-icon">
                <Sparkles size={17} />
              </div>
              <span>Find architectural insights</span>
            </div>

            <div className="auth-feature-item">
              <div className="auth-feature-icon">
                <Compass size={17} />
              </div>
              <span>Onboard faster</span>
            </div>
          </div>

          <div className="auth-quote-block">
            &ldquo;Every codebase has a story.<br />
            We help you see it.&rdquo;
          </div>
        </div>

        {/* Right Column: Glassmorphism Card */}
        <div className="auth-card">
          {/* Sign In / Sign Up Tabs */}
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              className={`auth-tab ${tab === 'signin' ? 'active' : ''}`}
              disabled={isLoading}
              onClick={() => {
                if (isLoading) return;
                setTab('signin');
                setLocalError(null);
                setSuccessMessage(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
              disabled={isLoading}
              onClick={() => {
                if (isLoading) return;
                setTab('signup');
                setLocalError(null);
                setSuccessMessage(null);
              }}
            >
              Sign Up
            </button>
            <div
              className="auth-tab-indicator"
              style={{
                transform: tab === 'signin' ? 'translateX(0%)' : 'translateX(100%)',
              }}
            />
          </div>

          {/* Heading */}
          <div className="auth-header">
            <h2 className="auth-title">
              {tab === 'signin' ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="auth-subtitle">
              {tab === 'signin'
                ? 'Continue your journey with The Astral Cartographer'
                : 'Start mapping the constellations of your codebase'}
            </p>
          </div>

          {/* Unconfigured Alert Banner */}
          {!isConfigured && (
            <div
              style={{
                background: 'rgba(56, 107, 255, 0.12)',
                border: '1px solid rgba(135, 155, 255, 0.28)',
                borderRadius: 9,
                padding: '10px 12px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 12,
                color: '#EAF0FF',
                lineHeight: 1.45,
              }}
            >
              <Info size={16} color="#8B78FF" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <span style={{ fontWeight: 500, color: '#F3F6FF' }}>Supabase Auth Setup Required: </span>
                Add your Supabase project keys in <code style={{ color: '#DDB39C', background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 4 }}>.env</code> to connect GitHub login.{' '}
                <button
                  type="button"
                  onClick={() => setShowConfigModal(!showConfigModal)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#A99AFF',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {showConfigModal ? 'Hide setup steps' : 'View setup steps'}
                </button>

                {showConfigModal && (
                  <pre
                    style={{
                      margin: '10px 0 4px',
                      padding: 10,
                      background: 'rgba(4, 8, 19, 0.85)',
                      border: '1px solid rgba(135, 155, 255, 0.2)',
                      borderRadius: 6,
                      fontSize: 11,
                      color: '#B8BBCB',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace',
                    }}
                  >
                    {getMissingSupabaseConfigInstructions()}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Local Error Alert with Actionable Recovery Buttons */}
          {localError && (
            <div
              style={{
                background: 'rgba(255, 113, 122, 0.12)',
                border: '1px solid rgba(255, 113, 122, 0.35)',
                borderRadius: 9,
                padding: '11px 13px',
                marginBottom: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 12,
                color: '#FFB3B8',
                lineHeight: 1.45,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle size={16} color="#FF717A" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
                  {getFriendlyErrorMessage(localError)}
                </div>
                <button
                  type="button"
                  onClick={() => setLocalError(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#FF717A',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                  aria-label="Dismiss error"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Action: Resend Verification Email button if email is unconfirmed */}
              {isUnconfirmedEmail(localError) && (
                <div style={{ paddingLeft: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isResending || resendCooldown > 0}
                    style={{
                      background: 'rgba(255, 113, 122, 0.2)',
                      border: '1px solid rgba(255, 113, 122, 0.45)',
                      color: '#FFE2E4',
                      borderRadius: 6,
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: isResending || resendCooldown > 0 ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isResending ? (
                      <>
                        <RefreshCw size={12} className="spin" /> Resending Link...
                      </>
                    ) : resendCooldown > 0 ? (
                      `Resend link in ${resendCooldown}s`
                    ) : (
                      'Resend Verification Link'
                    )}
                  </button>
                </div>
              )}

              {/* Action: Switch to Sign In button if email already exists */}
              {isUserAlreadyRegistered(localError) && (
                <div style={{ paddingLeft: 24 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      setLocalError(null);
                      setPassword('');
                    }}
                    style={{
                      background: 'rgba(139, 120, 255, 0.2)',
                      border: '1px solid rgba(139, 120, 255, 0.45)',
                      color: '#EAF0FF',
                      borderRadius: 6,
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    Switch to Sign In <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Success Message Alert */}
          {successMessage && (
            <div
              style={{
                background: 'rgba(67, 217, 163, 0.12)',
                border: '1px solid rgba(67, 217, 163, 0.3)',
                borderRadius: 9,
                padding: '10px 12px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 12,
                color: '#70E8BA',
                lineHeight: 1.4,
              }}
            >
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>{successMessage}</div>
              <button
                type="button"
                onClick={() => setSuccessMessage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#70E8BA',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* Social Auth Buttons */}
          <div className="auth-social-btns">
            <button
              type="button"
              className="social-button"
              onClick={handleGithubLogin}
              disabled={isLoading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>
                {loadingProvider === 'github'
                  ? 'Connecting to GitHub...'
                  : tab === 'signin'
                  ? 'Sign In with GitHub'
                  : 'Sign Up with GitHub'}
              </span>
            </button>

            <button
              type="button"
              className="social-button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>
                {loadingProvider === 'google'
                  ? 'Connecting to Google...'
                  : tab === 'signin'
                  ? 'Sign In with Google'
                  : 'Sign Up with Google'}
              </span>
            </button>
          </div>

          <div className="auth-divider">
            <span>or</span>
          </div>

          {/* Form */}
          <form className="auth-form" onSubmit={handleSubmit}>
            {tab === 'signup' && (
              <div className="auth-field">
                <div className="auth-input-wrapper">
                  <span className="auth-input-icon">
                    <User size={16} />
                  </span>
                  <input
                    type="text"
                    required
                    disabled={isLoading}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    placeholder="Full name"
                    className="auth-input has-left-icon"
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <Mail size={16} />
                </span>
                <input
                  type="email"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  placeholder="Email address"
                  className="auth-input has-left-icon"
                />
              </div>
            </div>

            <div className="auth-field">
              <div className="auth-input-wrapper">
                <span className="auth-input-icon">
                  <Lock size={16} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  placeholder={tab === 'signin' ? 'Password' : 'Create a secure password (min 6 chars)'}
                  className="auth-input has-left-icon has-right-icon"
                />
                <button
                  type="button"
                  className="auth-input-eye"
                  disabled={isLoading}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {tab === 'signup' && (
              <div className="auth-field">
                <div className="auth-input-wrapper">
                  <span className="auth-input-icon">
                    <Lock size={16} />
                  </span>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    disabled={isLoading}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    placeholder="Confirm password"
                    className="auth-input has-left-icon has-right-icon"
                  />
                  <button
                    type="button"
                    className="auth-input-eye"
                    disabled={isLoading}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {/* Remember Me / Forgot Password */}
            {tab === 'signin' ? (
              <div className="auth-row">
                <label className="auth-checkbox-label">
                  <input
                    type="checkbox"
                    className="auth-checkbox"
                    disabled={isLoading}
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  className="auth-link"
                  disabled={isLoading}
                  onClick={handleOpenResetModal}
                >
                  Forgot password?
                </button>
              </div>
            ) : (
              <div className="auth-row" style={{ marginTop: 2 }}>
                <label className="auth-checkbox-label">
                  <input
                    type="checkbox"
                    className="auth-checkbox"
                    disabled={isLoading}
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    required
                  />
                  <span style={{ fontSize: 11, color: '#A7B4CC' }}>
                    I agree to the Terms of Service & Privacy Policy
                  </span>
                </label>
              </div>
            )}

            {/* Primary Submit Button */}
            <button
              type="submit"
              className="primary-button"
              disabled={isLoading}
              style={{ width: '100%', marginTop: 8 }}
            >
              {loadingProvider === 'email'
                ? tab === 'signin'
                  ? 'Signing In...'
                  : 'Creating Account...'
                : tab === 'signin'
                ? 'Sign In'
                : 'Create Account'}
            </button>
          </form>

          {/* Footer Tab Switch */}
          <div className="auth-footer">
            {tab === 'signin' ? (
              <>
                Don&apos;t have an account?
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    if (isLoading) return;
                    setTab('signup');
                    setLocalError(null);
                    setSuccessMessage(null);
                  }}
                >
                  Sign Up
                </button>
              </>
            ) : (
              <>
                Already have an account?
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    if (isLoading) return;
                    setTab('signin');
                    setLocalError(null);
                    setSuccessMessage(null);
                  }}
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showResetModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4, 8, 19, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowResetModal(false);
            }
          }}
        >
          <div
            className="auth-card"
            style={{
              maxWidth: 420,
              width: '100%',
              margin: 0,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(139, 120, 255, 0.15)',
              border: '1px solid rgba(139, 120, 255, 0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="auth-title" style={{ fontSize: 18, margin: 0 }}>Reset Password</h3>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#B8BBCB',
                  cursor: 'pointer',
                  padding: 4,
                }}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
            <p className="auth-subtitle" style={{ marginBottom: 20 }}>
              Enter your account email and we&apos;ll send you a recovery link to choose a new password.
            </p>

            {resetError && (
              <div
                style={{
                  background: 'rgba(255, 113, 122, 0.12)',
                  border: '1px solid rgba(255, 113, 122, 0.3)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  marginBottom: 16,
                  fontSize: 12,
                  color: '#FF949C',
                  lineHeight: 1.4,
                }}
              >
                {resetError}
              </div>
            )}

            {resetSuccess && (
              <div
                style={{
                  background: 'rgba(67, 217, 163, 0.12)',
                  border: '1px solid rgba(67, 217, 163, 0.3)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  marginBottom: 16,
                  fontSize: 12,
                  color: '#70E8BA',
                  lineHeight: 1.4,
                }}
              >
                {resetSuccess}
              </div>
            )}

            <form onSubmit={handlePasswordResetSubmit}>
              <div className="auth-field" style={{ marginBottom: 18 }}>
                <div className="auth-input-wrapper">
                  <span className="auth-input-icon">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    required
                    disabled={isResetting}
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="Email address"
                    className="auth-input has-left-icon"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="primary-button"
                disabled={isResetting || resetCooldown > 0}
                style={{ width: '100%', marginBottom: 10 }}
              >
                {isResetting ? (
                  'Sending Recovery Link...'
                ) : resetCooldown > 0 ? (
                  `Resend available in ${resetCooldown}s`
                ) : (
                  'Send Recovery Link'
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: '#B8BBCB',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '8px 0',
                  textAlign: 'center',
                }}
              >
                Back to Sign In
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
