document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('guestLoginForm');
  const registerForm = document.getElementById('guestRegisterForm');
  const loginTab = document.getElementById('guestLoginTab');
  const registerTab = document.getElementById('guestRegisterTab');
  const message = document.getElementById('guestAccountMessage');

  function setMode(mode) {
    const registering = mode === 'register';
    loginForm.hidden = registering;
    registerForm.hidden = !registering;
    loginTab.className = registering ? 'btn btn-secondary' : 'btn btn-primary';
    registerTab.className = registering ? 'btn btn-primary' : 'btn btn-secondary';
    message.textContent = '';
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  setMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');

  const fullName = document.getElementById('guestFullName');
  fullName.addEventListener('input', () => {
    const name = fullName.value.trim().replace(/\s+/g, ' ');
    fullName.setCustomValidity(
      /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*(?: [A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*)+$/.test(name)
        ? ''
        : 'Enter a valid first and last name.'
    );
  });
  const password = document.getElementById('guestRegisterPassword');
  password.addEventListener('input', () => {
    password.setCustomValidity(
      /^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(password.value)
        ? ''
        : 'Use at least one letter and one number, without spaces.'
    );
  });

  try {
    const session = await apiRequest('/auth/me');
    if (session.role === 'Guest') window.location.replace('guest-dashboard.html');
  } catch (error) {
    if (error.message !== 'A valid login is required.') {
      console.warn('Unable to verify an existing guest session.', error);
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

  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    message.className = 'guest-message';
    message.textContent = 'Creating your account…';
    const formData = new FormData(registerForm);
    try {
      const registration = await apiRequest('/guest/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: formData.get('fullName').trim().replace(/\s+/g, ' '),
          email: formData.get('email').trim(),
          phone: formData.get('phone').trim(),
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
