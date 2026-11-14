document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('guestLoginForm');
  const registerForm = document.getElementById('guestRegisterForm');
  const loginTab = document.getElementById('guestLoginTab');
  const registerTab = document.getElementById('guestRegisterTab');
  const authToggle = document.getElementById('guestAuthToggle');
  const forgotPasswordButton = document.getElementById('guestForgotPasswordButton');
  const forgotPanel = document.getElementById('guestForgotPanel');
  const forgotForm = document.getElementById('guestForgotForm');
  const resetPanel = document.getElementById('guestResetPanel');
  const resetForm = document.getElementById('guestResetForm');
  const message = document.getElementById('guestAccountMessage');
  let resetToken = new URLSearchParams(window.location.hash.slice(1)).get('reset_token') || '';

  function normalizeIndianMobile(value) {
    const normalized = String(value).replace(/[\s()-]/g, '');
    let nationalNumber = normalized;
    if (normalized.startsWith('+91')) {
      nationalNumber = normalized.slice(3);
    } else if (normalized.length === 12 && normalized.startsWith('91')) {
      nationalNumber = normalized.slice(2);
    }
    return /^[6-9][0-9]{9}$/.test(nationalNumber) ? `+91${nationalNumber}` : '';
  }

  function setMode(mode) {
    const registering = mode === 'register';
    const recovering = mode === 'forgot' || mode === 'reset';
    authToggle.hidden = recovering;
    loginForm.hidden = registering || recovering;
    registerForm.hidden = !registering;
    forgotPanel.hidden = mode !== 'forgot';
    resetPanel.hidden = mode !== 'reset';
    loginTab.className = registering ? 'btn btn-secondary' : 'btn btn-primary';
    registerTab.className = registering ? 'btn btn-primary' : 'btn btn-secondary';
    message.textContent = '';
  }

  function clearResetTokenFromUrl() {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  forgotPasswordButton.addEventListener('click', () => {
    document.getElementById('guestForgotEmail').value =
      document.getElementById('guestLoginEmail').value.trim();
    setMode('forgot');
  });
  document.getElementById('guestBackFromForgot').addEventListener('click', () => setMode('login'));
  document.getElementById('guestBackFromReset').addEventListener('click', () => {
    resetToken = '';
    setMode('login');
  });

  const fullName = document.getElementById('guestFullName');
  fullName.addEventListener('input', () => {
    const name = fullName.value.trim().replace(/\s+/g, ' ');
    fullName.setCustomValidity(
      /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*(?: [A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*)+$/.test(name)
        ? ''
        : 'Enter a valid first and last name.'
    );
  });

  const phoneInput = document.getElementById('guestRegisterPhone');
  const phoneError = 'Enter a valid 10-digit Indian mobile number starting with 6-9, optionally with +91.';
  phoneInput.addEventListener('input', () => {
    phoneInput.setCustomValidity(
      !phoneInput.value.trim() || normalizeIndianMobile(phoneInput.value) ? '' : phoneError
    );
  });

  function validateGuestPassword(input) {
    input.addEventListener('input', () => {
      input.setCustomValidity(
        /^(?=.*[A-Za-z])(?=.*\d)\S{10,200}$/.test(input.value)
          ? ''
          : 'Use at least 10 characters, including a letter and a number; no spaces.'
      );
    });
  }

  const registerPassword = document.getElementById('guestRegisterPassword');
  const resetPassword = document.getElementById('guestResetPassword');
  const resetPasswordConfirm = document.getElementById('guestResetPasswordConfirm');
  validateGuestPassword(registerPassword);
  validateGuestPassword(resetPassword);

  function validateResetPasswordConfirmation() {
    resetPasswordConfirm.setCustomValidity(
      resetPasswordConfirm.value && resetPasswordConfirm.value !== resetPassword.value
        ? 'Passwords do not match.'
        : ''
    );
  }

  resetPassword.addEventListener('input', validateResetPasswordConfirmation);
  resetPasswordConfirm.addEventListener('input', validateResetPasswordConfirmation);

  if (resetToken) {
    clearResetTokenFromUrl();
    setMode('reset');
  } else {
    setMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
  }

  if (!resetToken) {
    try {
      const session = await apiRequest('/auth/me');
      if (session.role === 'Guest') window.location.replace('guest-dashboard.html');
    } catch (error) {
      if (error.message !== 'A valid login is required.') {
        console.warn('Unable to verify an existing guest session.', error);
      }
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    message.className = 'guest-message';
    message.textContent = 'Signing in…';
    const formData = new FormData(loginForm);
    try {
      const session = await apiRequest('/guest/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email').trim(),
          password: formData.get('password')
        })
      });
      HotelStore.setAuth({ loggedIn: true, user: session.email, role: session.role });
      window.location.assign('guest-dashboard.html');
    } catch (error) {
      message.className = 'guest-message error';
      message.textContent = error.message;
    }
  });

  forgotForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!forgotForm.reportValidity()) return;
    message.className = 'guest-message';
    message.textContent = 'Requesting a reset link…';
    const formData = new FormData(forgotForm);
    try {
      const result = await apiRequest('/guest/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: formData.get('email').trim() })
      });
      message.className = 'guest-message success';
      message.textContent = result.message;
    } catch (error) {
      message.className = 'guest-message error';
      message.textContent = error.message;
    }
  });

  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    validateResetPasswordConfirmation();
    if (!resetForm.reportValidity()) return;
    if (!resetToken) {
      message.className = 'guest-message error';
      message.textContent = 'This reset link is invalid or has expired. Request a new link.';
      return;
    }
    message.className = 'guest-message';
    message.textContent = 'Updating your password…';
    try {
      await apiRequest('/guest/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: resetPassword.value
        })
      });
      resetToken = '';
      resetForm.reset();
      setMode('login');
      message.className = 'guest-message success';
      message.textContent = 'Password updated. You can now sign in.';
    } catch (error) {
      message.className = 'guest-message error';
      message.textContent = error.message;
    }
  });

  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    message.className = 'guest-message';
    message.textContent = 'Creating your account…';
    const formData = new FormData(registerForm);
    const phone = normalizeIndianMobile(formData.get('phone'));
    if (!phone) {
      phoneInput.setCustomValidity(phoneError);
      phoneInput.reportValidity();
      return;
    }
    phoneInput.setCustomValidity('');
    try {
      const registration = await apiRequest('/guest/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: formData.get('fullName').trim().replace(/\s+/g, ' '),
          email: formData.get('email').trim(),
          phone,
          password: formData.get('password')
        })
      });
      setMode('login');
      document.getElementById('guestLoginEmail').value = registration.email;
      document.getElementById('guestLoginPassword').value = '';
      message.className = 'guest-message success';
      message.textContent = `Registration successful for ${registration.email}. Please sign in with your new account.`;
      notifyMongoSyncStatus(registration.mongoSynced, 'Guest details saved in PostgreSQL.');
    } catch (error) {
      message.className = 'guest-message error';
      message.textContent = error.message;
    }
  });
});
