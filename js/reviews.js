document.addEventListener('DOMContentLoaded', () => {
  renderReviewsTable();
  setupReviewForm();
});

function renderReviewsTable() {
  const tableBody = document.getElementById('reviewsTableBody');
  if (!tableBody) return;

  const reviews = HotelStore.getReviews();
  if (!reviews.length) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 32px; color: var(--text-muted);">No guest reviews yet.</td></tr>';
    return;
  }

  tableBody.innerHTML = reviews.map(review => `
    <tr>
      <td>${review.reviewId}</td>
      <td>${review.guestName}</td>
      <td>${review.bookingId}</td>
      <td>${review.rating} / 5</td>
      <td>${review.comment || '—'}</td>
    </tr>
  `).join('');
}

function setupReviewForm() {
  const form = document.getElementById('newReviewForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const review = {
      reviewId: `REV-${Date.now().toString().slice(-5)}`,
      guestName: document.getElementById('reviewGuest').value.trim(),
      bookingId: document.getElementById('reviewBooking').value.trim(),
      rating: Number(document.getElementById('reviewRating').value || 5),
      comment: document.getElementById('reviewComment').value.trim()
    };

    const reviews = HotelStore.getReviews();
    reviews.push(review);
    HotelStore.saveReviews(reviews);
    form.reset();
    closeModal('newReviewModal');
    renderReviewsTable();
    showToast(`Review ${review.reviewId} saved.`, 'success');
  });
}
