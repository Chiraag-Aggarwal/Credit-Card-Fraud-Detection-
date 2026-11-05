# Testing the dashboard

## Automated checks

From `client/`, install the packages with `npm ci`, then run:

```sh
npm test
npm run lint
npm run build
```

The frontend tests cover stored appearance settings, invalid or blocked browser storage, Hindi error messages, mock profile editing and duplicate emails, stable login identity after an email edit, stale request cancellation, and inclusive date filters.

From `server/`, install `requirements.txt` in a virtual environment, then run:

```sh
python -m unittest discover -s tests -v
```

These profile API tests use an isolated database adapter. They check authentication, input validation, duplicate-email conflicts, user isolation, private-field protection, and login after changing an email. A running MongoDB instance or ML service is not needed for these tests.

## Browser checks

Use `VITE_USE_MOCK=true` for frontend checks without the backend. Demo profile information stays in this browser; mock transactions reset after a reload.

1. Register, sign in, and open each screen. Check the 24-hour and 30-day charts.
2. Simulate ten transactions, simulate a fraud burst, and try demo checkout. Confirm that the totals update and that the checkout says no payment was processed.
3. Filter flagged transactions by risk and dates, view explanations, and try both review decisions. Check pagination after marking a payment legitimate.
4. Update a profile name and email, refresh, and sign in using the new email. Try an invalid email and cancel an unsaved edit.
5. Change language, brightness, colour, font size, and font family. Refresh and confirm the choices remain. Check Hindi with large text in dark mode.
6. Upload a valid CSV and an invalid CSV to Batch AI analysis. Confirm results and clear validation messages.
7. Check the layouts at 1440, 390, and 320 pixels wide. Phone pages should not scroll sideways; wide analysis tables have their own scroll area.
8. Confirm transaction polling runs every five seconds and stops when leaving the dashboard. Alert polling runs every fifteen seconds and stops after logout.

For real API testing, use `VITE_USE_MOCK=false`, set `VITE_API_URL`, and run the Python API with MongoDB and the model service. Test Razorpay with test credentials only. The demo checkout is not a real payment-provider integration test.
