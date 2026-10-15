<div align="center">

# CampusPass

### Smart Campus Attendance System

Staff attendance with PIN authentication, face verification, and campus geofencing.

[![React](https://img.shields.io/badge/Frontend-React-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)

</div>

CampusPass is a web-based staff attendance management system built with **React + Vite** on the frontend and **FastAPI** on the backend. Staff can check in and out after PIN sign-in, face verification, and a GPS check against the campus geofence. Administrators can manage staff accounts and review attendance.

> [!NOTE]
> This README describes the local development setup. Values shown for environment variables are examples; confirm the exact names, database schema, and dependencies against the backend before running the project.

## Contents

- [Overview](#overview)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Database setup](#database-setup)
- [Run locally](#run-locally)
- [How to use](#how-to-use)
- [API overview](#api-overview)
- [Attendance validation flow](#attendance-validation-flow)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Development notes](#development-notes)
- [Future improvements](#future-improvements)
- [License](#license)

## Overview

The system is intended to make staff attendance easier to record and administer. Staff sign in with their staff ID and PIN, verify their face using the camera, and submit a check-in or check-out request. The backend validates the request, including the staff member's face-verification proof and GPS location relative to the configured campus area.

Administrators can view an overview, manage staff accounts, enroll a face profile for an active staff member, reset staff PINs, activate or deactivate accounts, and review attendance history.

## Features

### Staff

- Sign in with a staff ID and PIN.
- Use the device camera for face verification.
- Mark check-in and check-out.
- Validate GPS coordinates against the configured campus geofence.
- Enforce a minimum GPS accuracy requirement configured on the backend.
- View attendance records/history where enabled in the current UI.

### Administration

- Admin authentication and protected admin pages.
- Dashboard overview and attendance summaries.
- View the staff list.
- Create staff accounts.
- Reset staff PINs.
- Activate or deactivate staff accounts.
- Enroll or update a staff member's face profile through the camera.
- Review attendance history.

### Backend and data

- FastAPI REST API.
- JWT-based authentication for protected endpoints.
- Supabase-hosted PostgreSQL database.
- Staff PINs stored as salted PBKDF2-SHA256 hashes (not as plain text).
- Face profile and attendance face-proof records stored separately from basic staff account data.

## Technology stack

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, CSS |
| Backend | Python, FastAPI, Uvicorn |
| Database | PostgreSQL hosted by Supabase |
| Authentication | PIN login and JWT bearer tokens |
| Browser capabilities | Camera access and Geolocation API |
| API documentation | FastAPI Swagger UI / OpenAPI |

## Project structure

The repository is organized into the following areas:

```text
CampusPass-IGNITE/
├── backend/     # FastAPI backend
├── frontend/    # React + Vite frontend
├── Docs/        # Project documentation
└── README.md
```

Backend modules, migrations, and configuration may be added within their respective folders. Do not commit `.env` files, service-role keys, JWT secrets, or other credentials.

## Requirements

Install the following before starting:

- Python 3.10+ (use the version required by your installed dependencies if different).
- Node.js and npm.
- A Supabase project with a PostgreSQL database.
- A modern browser with camera and location permissions.
- A webcam or phone camera for face enrollment and verification.

Camera and geolocation APIs generally require a secure context. `localhost` is treated as secure by modern browsers for development. For deployment, use HTTPS.

## Configuration

Create a `.env` file in the backend directory (the directory from which you run `main.py`) and set the variables used by your backend. The current project setup uses these configuration values:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
JWT_SECRET_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET

# Campus geofence configuration — use the exact variable names
# referenced in main.py if they differ from these illustrative names.
CAMPUS_LATITUDE=YOUR_CAMPUS_LATITUDE
CAMPUS_LONGITUDE=YOUR_CAMPUS_LONGITUDE
CAMPUS_RADIUS_METERS=YOUR_ALLOWED_RADIUS_IN_METERS
GPS_MAX_ACCURACY_METERS=50
```

**Important:** The campus variable names above are descriptive examples. Check `main.py` and use the exact names it reads. Do not use placeholder values in a running deployment. Set the campus coordinates to the actual campus location and choose a geofence radius appropriate for the site.

### Secrets and environment variables

- Keep `.env` out of Git. Add it to `.gitignore`.
- Never place the Supabase secret/service-role key or JWT secret in frontend code or a `VITE_*` variable.
- If a secret is accidentally committed, rotate it immediately.
- Use separate credentials for development and production.

## Database setup

CampusPass uses Supabase-hosted PostgreSQL. The current application data model includes the following tables:

| Table | Purpose |
|---|---|
| `staff_users` | Staff/admin accounts, role, PIN hash and salt, creation time, and account status where configured |
| `attendance` | Attendance records, including staff ID, check-in/check-out timestamps, and creation time |
| `staff_face_profiles` | Face enrollment/profile data associated with a staff member |
| `attendance_face_proofs` | Face-verification proof associated with attendance attempts/records |

The exact columns and constraints are defined by the backend implementation and database setup. Ensure the tables and required columns exist in Supabase before running the API. Row Level Security (RLS) is enabled in the described setup; configure database policies carefully. The backend secret key has elevated privileges, so it must remain server-side only.

If this is a fresh clone and no migration/schema script is present in the repository, create the tables according to the SQL/schema expected by `main.py` before testing the application. Do not guess column names—use the queries and field names in the backend code as the source of truth.

## Run locally

Open **two terminals** from the project root.

### 1. Start the backend

Create and activate a virtual environment (recommended):

**Windows PowerShell**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS/Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install backend dependencies. If the repository has a `requirements.txt`, use it:

```bash
pip install -r requirements.txt
```

If there is no dependency file, install the dependencies used by the backend and then create a `requirements.txt` for reproducible installs. At minimum, the known server entry point requires FastAPI and Uvicorn; the application also needs the packages imported by `main.py` for Supabase, JWT, password hashing, face processing, and environment configuration.

Start the API from the directory containing `main.py`:

```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8100
```

Backend URLs:

- API base URL: `http://127.0.0.1:8100`
- Health/root check: `http://127.0.0.1:8100/health` or `http://127.0.0.1:8100/` (depending on the route)
- Interactive API docs: `http://127.0.0.1:8100/docs`
- OpenAPI schema: `http://127.0.0.1:8100/openapi.json`

### 2. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5180
```

Open the Vite URL shown in the terminal, normally:

```text
http://127.0.0.1:5180
```

The frontend uses `https://campus-pass-lf2a.onrender.com` as its default API base URL. To use a local backend, set `VITE_API_URL=http://127.0.0.1:8100` in the frontend environment. Ensure backend CORS allows the frontend origin.

## How to use

### Staff attendance

1. Open the frontend in a supported browser.
2. Sign in using the staff ID and PIN provisioned for your environment.
3. Allow camera access when prompted.
4. Complete face verification.
5. Allow location access and move to an area where the browser can obtain a sufficiently accurate GPS fix.
6. Submit check-in or check-out.
7. If the backend rejects the request, read the on-screen message. Common causes include low GPS accuracy, being outside the campus geofence, missing face verification, or an inactive account.

### Admin workflow

1. Sign in with an account whose role is administrator.
2. Open the staff management section.
3. Create a staff account if needed.
4. For an active staff member, select **Enroll face** and follow the camera prompt.
5. Reset a PIN or activate/deactivate the account as needed.
6. Use the dashboard and history section to review attendance information.

Demo credentials may exist in a local development database, but they are not guaranteed to be seeded in every environment. If your local setup uses the example accounts `STF001` / `1234` and `ADM001` / `000000`, change these credentials before any real deployment and do not publish real credentials in this README.

## API overview

The API is implemented in `main.py`. The following endpoints are part of the current application flow; consult `/docs` for the exact request/response schemas and any additional routes.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | Root/API status response |
| `GET` | `/health` | Health check |
| `POST` | `/auth/login` | Authenticate using staff ID and PIN; returns an auth token on success |
| `POST` | `/face/verify` | Verify a face for the signed-in staff member and produce verification information/proof |
| `POST` | `/attendance/check-in` | Record a check-in after required verification and location checks |
| `POST` | `/attendance/check-out` | Record a check-out after required verification and location checks |
| `POST` | `/admin/staff/{staff_id}/face` | Enroll/update a staff member's face profile (admin-only) |

The backend also provides admin dashboard/staff management and attendance-history routes. Their exact paths may vary with the current `main.py`; use Swagger UI at `/docs` to inspect all registered endpoints.

### Authentication

Protected API calls use the bearer token returned by login. Include it in the request header:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Do not share tokens or store them in public repositories. Admin routes should only be used by authenticated users with the administrator role.

## Attendance validation flow

A successful attendance request is expected to pass the checks implemented by the backend:

1. **Authentication:** the token must be valid and identify an active staff account.
2. **Face verification:** the staff member must complete the required face-verification step; attendance requests without the required proof can be rejected.
3. **Location permission:** the browser must return GPS coordinates.
4. **GPS accuracy:** the reported accuracy must meet the configured threshold. For example, if the limit is 50 metres, a reading with 151-metre accuracy is too imprecise.
5. **Campus geofence:** the coordinates must be inside the configured campus radius.
6. **Attendance rules:** the backend applies the check-in/check-out rules and records the result in the database.

GPS is an estimate, not a guarantee of physical presence. Indoor locations, browser permission settings, device hardware, and network conditions can affect accuracy. A location check alone should not be treated as strong proof of attendance.

## Security and privacy

- Use HTTPS outside local development.
- Protect all admin endpoints with server-side role checks.
- Store PINs as salted password hashes; never log or expose plain-text PINs.
- Keep Supabase and JWT secrets on the backend only.
- Apply least-privilege access and appropriate RLS policies.
- Treat face data and attendance records as sensitive personal information. Collect only what is necessary, limit access, and define a retention/deletion policy.
- Tell staff what face and location information is collected and why; obtain any consent or authorization required by applicable law and institutional policy.
- Do not rely on client-side checks alone. Validate tokens, roles, face proofs, GPS accuracy, geofence distance, and attendance rules on the server.
- Before deployment, review face matching/liveness protections, rate limiting, audit logs, backup/restore, and error messages for sensitive information.

## Troubleshooting

### `POST /attendance/check-in` returns `400 Bad Request`

Read the response body shown in the frontend or backend logs. It may explain that the location is outside the campus area, GPS accuracy is insufficient, or required verification is missing. Fix the stated condition rather than repeatedly retrying the same request.

### “Your GPS accuracy is too low”

- Move near an open area or outdoors.
- Wait for the browser to improve its location fix.
- Ensure location permission is enabled for the site.
- Confirm the configured accuracy threshold is suitable for your use case.
- Test near the actual campus; testing from home should normally fail the campus geofence check.

### Camera does not open

- Allow camera access in browser permissions.
- Close other apps/tabs that may be using the camera.
- Check that the page is running on `localhost` or HTTPS.
- Verify the browser can access a camera and inspect the browser console for errors.

### Frontend cannot reach the backend

- Confirm Uvicorn is running on port `8100`.
- Check that `VITE_API_URL` points to the intended backend, or that the default API URL `https://campus-pass-lf2a.onrender.com` is reachable.
- Ensure CORS allows the frontend origin, normally `http://127.0.0.1:5180`.
- Check terminal logs and browser DevTools Network/Console tabs.

### Login or database errors

- Confirm the `.env` file is loaded from the backend's working directory.
- Verify `SUPABASE_URL` and the server-side secret key.
- Confirm the required Supabase tables/columns exist.
- Verify the account is active and its role/PIN are correct.
- Restart the backend after changing environment variables.

### Face enrollment fails

- Confirm the account is active and the signed-in user has admin permissions.
- Allow camera access and ensure the video preview is working.
- Check the API response and backend logs for the enrollment endpoint.
- Confirm the face-profile table/schema expected by the backend is available.

## Development notes

- Backend entry point: `main.py`.
- Frontend entry point: `frontend/src/main.tsx`.
- Main UI: `frontend/src/App.tsx` and `frontend/src/App.css`.
- Local frontend: port `5180`.
- Local backend: port `8100`.
- API docs: `/docs`.
- Keep frontend and backend running in separate terminals during development.
- When adding or renaming endpoints, update this README and verify the request/response contracts in Swagger UI.

## Future improvements

- Add automated tests for authentication, geofence validation, face enrollment, and attendance transitions.
- Add database migrations and a documented seed-data script.
- Add audit logs for administrative actions.
- Add a clear face-enrollment status in the staff table.
- Add exportable attendance reports and filters.
- Add production deployment instructions, monitoring, backups, and restore testing.
- Evaluate liveness detection and spoofing resistance for face verification.
- Add a clear privacy notice and configurable retention policy for face and location data.

## License

No license has been specified yet. Add a `LICENSE` file and update this section before publishing or distributing the project.
