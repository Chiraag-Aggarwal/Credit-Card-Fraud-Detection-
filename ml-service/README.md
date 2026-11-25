# Fraud model service

This service trains a supervised transaction classifier and a separate unsupervised anomaly baseline, then serves predictions from the selected supervised model with per-transaction TreeSHAP explanations.

## Train from the public dataset

The original dataset is intentionally not committed because it is about 150 MB. Put the supplied `creditcard.csv` at `ml-service/data/creditcard.csv`, or run `python -m training.fetch_dataset` from this folder to fetch and verify the matching public ULB/OpenML copy. The CSV is ignored by Git.

From `ml-service/`, run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip==26.2
python -m pip install -r requirements.txt
python -m training.run_pipeline
```

For notebooks and the existing test suite, install the optional development tools with `python -m pip install -r requirements-dev.txt`.

The pipeline validates the 284,807-row dataset, makes stratified train/validation/test splits before fitting transforms, compares balanced logistic regression and XGBoost with and without training-only SMOTE, selects by validation PR-AUC, selects a decision threshold on validation data, and reports final metrics once on the held-out test split. It also evaluates Isolation Forest using genuine training rows only, calculates global permutation importance, and creates a small labeled replay set from held-out test rows for the dashboard simulator.

## Model artifacts

`artifacts/model.joblib`, `threshold.json`, and `metrics.json` are the live supervised model and its decision settings. The comparison CSV, precision-recall chart, confusion matrix, and feature-importance chart document the model selection. `isolation_forest_metrics.json` is a research baseline; its anomaly scores are not calibrated fraud probabilities and are not used by the API's production prediction path.

Latest held-out results from the supplied dataset:

| Model | Threshold | Precision | Recall | F1 | ROC-AUC | PR-AUC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XGBoost (selected on validation PR-AUC) | 0.0795 | 0.8300 | 0.8384 | 0.8342 | 0.9700 | 0.8652 |
| Isolation Forest (unsupervised baseline) | 0.1648* | 0.2099 | 0.1717 | 0.1889 | 0.9551 | 0.1126 |

`*` The Isolation Forest precision target could not be met on validation, so its threshold maximizes validation F1 instead. The XGBoost test confusion matrix is `[[56846, 17], [16, 83]]` (rows: actual genuine/fraud; columns: predicted genuine/fraud). Its threshold was selected on validation to meet a minimum precision of 0.80; the test split was kept separate. These results describe a randomized holdout of a historical dataset, not current real-world performance.

The FastAPI app exposes `/health`, `/predict`, `/predict/batch`, `/explain`, and `/model-info`. The dashboard's batch analyzer accepts up to 100 CSV rows and does not persist them. The `/explain` route returns the five strongest TreeSHAP contributions for XGBoost, or exact coefficient contributions for logistic regression, in log-odds. Since V1–V28 are anonymized PCA components, an explanation describes model behavior, not a human-readable cause or proof of fraud.

## Serve and verify

Use Python 3.12 and the pinned requirements. From `ml-service/` run `uvicorn app.main:app --host 0.0.0.0 --port 8000` (add `--env-file .env` only if `python-dotenv` is installed, or set environment variables in your shell). Set `APP_ENV=production` and a non-empty `ML_API_KEY` in hosted environments. The API backend must use the same key in its `X-API-Key` header. Never expose that key in frontend `VITE_*` settings.

`/health` is unauthenticated for hosting probes. It becomes ready only after the artifact loads and produces a finite, correctly shaped probability; it returns HTTP 503 when the model is not ready. All other routes require the configured key. Startup refuses incompatible scikit-learn pickle versions; keep the serialized model and its pinned runtime together. Predictions outside [0, 1], non-finite predictions, and invalid explanation values are rejected instead of returned to clients.

Run `python -m pip install --upgrade pip==26.2`, then `python -m pip install -r requirements.txt pytest==9.1.1 httpx==0.28.1` and `python -m pytest tests -q`. This runs the full preparation/training unit suite, real artifact replay checks, and authenticated production prediction/explanation checks. The small unit-test datasets do not retrain or reevaluate the committed historical model, and replay ranking is not a new performance estimate.

The root `render.yaml` uses two Python web services and one Vite static site, with a generated shared ML key and payments disabled. Supply the Neon PostgreSQL `DATABASE_URL` (including `sslmode=require`), actual frontend URL as API `CLIENT_URL`, actual ML URL as API `ML_SERVICE_URL`, and API URL as frontend `VITE_API_URL`. Rebuild the static site after changing its API URL. Free web services may sleep; the first request can wait for startup. No hosting resources are created merely by adding these files.

For local containers, export `POSTGRES_PASSWORD` using URL-safe characters, `ML_API_KEY`, and a `JWT_SECRET` of at least 32 characters, then run `docker compose up --build` at the repository root. It starts PostgreSQL, migrates its schema, and waits for ML readiness before starting the API on `127.0.0.1:5000`. Run Vite separately with `VITE_USE_MOCK=false` and `VITE_API_URL=http://localhost:5000`. PostgreSQL data persists in the named volume. Docker execution must be verified on a machine with Docker installed; native tests do not validate container builds.

## Data limits

The ULB/Kaggle dataset contains anonymized transactions from two days in 2013, with 492 fraud rows among 284,807 total rows. It is useful for a reproducible demonstration, but it is not representative of current card traffic or a production merchant's data. Mock dashboard mode does not call this service.
