let editingReviewId = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await HotelStore.initialize();
  } catch (error) {
    console.error('Unable to initialize reviews from PostgreSQL.', error);
    showToast(`Could not load hotel data from the database: ${error.message}`, 'error');
    return;
  }
  populateReviewBookingOptions();
  renderReviewsTable();
  setupReviewForm();
  bindActionMenu(document.getElementById('reviewsTableBody'), (action, reviewId) => {
    if (action === 'edit') editReview(reviewId);
    if (action === 'delete') deleteReview(reviewId);
  });
});

function renderReviewsTable() {
  const tableBody = document.getElementById('reviewsTableBody');
  if (!tableBody) return;

  const reviews = HotelStore.getReviews();
  if (!reviews.length) {
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 32px; color: var(--text-muted);">No guest reviews yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = reviews.map(review => `
    <tr>
      <td>${review.reviewId}</td>
      <td>${escapeHtml(review.guestName)}</td>
      <td>${escapeHtml(review.bookingId)}</td>
      <td>${review.rating} / 5</td>
      <td>${escapeHtml(review.comment || '—')}</td>
      <td>${renderActionMenu(review.reviewId, [
        { action: 'edit', label: 'Edit review' },
        { action: 'delete', label: 'Delete review' }
      ])}</td>
    </tr>
  `).join('');
}

function populateReviewBookingOptions() {
  const select = document.getElementById('reviewBooking');
  select.innerHTML = '<option value="">Select a reservation</option>' +
    HotelStore.getBookings().map(booking =>
      `<option value="${escapeHtml(booking.bookingId)}">${escapeHtml(booking.bookingId)} — ${escapeHtml(booking.guestName)}</option>`
    ).join('');
  select.addEventListener('change', () => {
    const booking = HotelStore.getBookings().find(item => item.bookingId === select.value);
    document.getElementById('reviewGuest').value = booking ? booking.guestName : '';
  });
}

function setupReviewForm() {
  const form = document.getElementById('newReviewForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reviews = HotelStore.getReviews();
    const reviewId = editingReviewId || `REV-${crypto.randomUUID().slice(0, 16).toUpperCase()}`;
    const review = {
      reviewId,
      guestName: document.getElementById('reviewGuest').value.trim(),
      bookingId: document.getElementById('reviewBooking').value,
      rating: Number(document.getElementById('reviewRating').value || 5),
      comment: document.getElementById('reviewComment').value.trim()
    };

    const existingIndex = reviews.findIndex(item => item.reviewId === editingReviewId);
    if (existingIndex >= 0) reviews[existingIndex] = review;
    else reviews.push(review);
    if (await HotelStore.saveReviews(reviews) === false) return;
    const wasEditing = Boolean(editingReviewId);
    editingReviewId = null;
    form.reset();
    closeModal('newReviewModal');
    document.getElementById('reviewGuest').value = '';
    document.getElementById('reviewModalTitle').textContent = 'Record Guest Review';
    document.getElementById('reviewSubmitButton').textContent = 'Save Review';
    renderReviewsTable();
    showToast(`Review ${review.reviewId} ${wasEditing ? 'updated' : 'saved'}.`, 'success');
  });
}

function editReview(reviewId) {
  const review = HotelStore.getReviews().find(item => item.reviewId === reviewId);
  if (!review) return;
  editingReviewId = reviewId;
  document.getElementById('reviewBooking').value = review.bookingId || '';
  document.getElementById('reviewGuest').value = review.guestName || '';
  document.getElementById('reviewRating').value = String(review.rating || 5);
  document.getElementById('reviewComment').value = review.comment || '';
  document.getElementById('reviewModalTitle').textContent = `Edit Review ${reviewId}`;
  document.getElementById('reviewSubmitButton').textContent = 'Save Changes';
  openModal('newReviewModal');
}

function startNewReview() {
  editingReviewId = null;
  document.getElementById('newReviewForm').reset();
  document.getElementById('reviewGuest').value = '';
  document.getElementById('reviewModalTitle').textContent = 'Record Guest Review';
  document.getElementById('reviewSubmitButton').textContent = 'Save Review';
  openModal('newReviewModal');
}

async function deleteReview(reviewId) {
  if (!confirm(`Delete review ${reviewId}?`)) return;
  const reviews = HotelStore.getReviews().filter(review => review.reviewId !== reviewId);
  if (await HotelStore.saveReviews(reviews) === false) return;
  renderReviewsTable();
  showToast(`Review ${reviewId} deleted.`, 'info');
}
