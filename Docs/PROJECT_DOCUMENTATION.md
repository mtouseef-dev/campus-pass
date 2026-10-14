# CampusPass Project Documentation

## 1. Project overview

CampusPass is a smart campus attendance system built for staff attendance tracking using a combination of:

- Staff ID + PIN authentication
- Face verification with webcam capture
- GPS location validation and campus geofencing
- Admin dashboard for staff management and attendance monitoring

The project is split into:

- Frontend: React + TypeScript + Vite
- Backend: Python + FastAPI
- Database: Supabase PostgreSQL
- Authentication: JWT bearer tokens
- Face recognition: OpenCV + DeepFace
- Geofencing: custom Haversine distance logic

This is an MVP/local-development project designed to demonstrate secure attendance verification in a campus environment.

---

## 2. What the system does

### Staff features

- Sign in using Staff ID and PIN
- Use camera for face verification
- Check in or check out
- Validate GPS coordinates against a campus geofence
- Enforce GPS accuracy thresholds
- View personal attendance records

### Admin features

- Admin login
- Dashboard overview
- Create staff accounts
- Reset staff PINs
- Activate or deactivate staff accounts
- Enroll or update staff face data
- Review attendance history and status summaries

---

## 3. High-level architecture

```text
Browser (React app)
  |
  v
Frontend (Vite + React)
  |
  | fetch/HTTP
  v
FastAPI backend
  |
  +-- Authenticates users with JWT
  +-- Validates GPS and campus area
  +-- Verifies face proof against stored embeddings
  +-- Reads/writes Supabase data
  v
Supabase PostgreSQL
```

### Data flow

1. Staff logs into the app with Staff ID and PIN.
2. Backend validates credentials and issues a JWT token.
3. Staff uses the camera to verify their face.
4. Backend compares the live face to the stored profile embedding.
5. Staff allows GPS access and submits an attendance action.
6. Backend checks:
   - token validity
   - staff account status
   - GPS accuracy
   - campus geofence
   - face proof validity
   - duplicate attendance rules
7. Attendance is saved in the database.

---

## 4. Project structure

```text
CampusPass/
├── README.md
├── PROJECT_DOCUMENTATION.md
├── requirements.txt
├── backend/
│   ├── .env
│   ├── main.py
│   └── .venv/
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── .oxlintrc.json
│   ├── README.md
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── index.css
│       ├── App.tsx
│       ├── App.css
│       └── assets/
├── docs/
└── .gitignore (if present in root)
```

### Important files

- [README.md](./README.md) - project quick-start documentation
- [requirements.txt](./requirements.txt) - Python dependency list
- [backend/main.py](./backend/main.py) - main backend application logic
- [backend/.env](./backend/.env) - environment variables for local dev
- [frontend/src/App.tsx](./frontend/src/App.tsx) - main frontend application
- [frontend/src/App.css](./frontend/src/App.css) - styling
- [frontend/package.json](./frontend/package.json) - frontend scripts and dependencies

---

## 5. Technology stack

### Frontend

- React
- TypeScript
- Vite
- CSS

### Backend

- Python
- FastAPI
- Uvicorn
- JWT
- DeepFace
- OpenCV
- NumPy
- Supabase Python client

### Database

- Supabase (PostgreSQL)

### Browser features used

- Camera access
- Geolocation API

---

## 6. Backend overview

The backend is implemented in [backend/main.py](./backend/main.py). It contains nearly all of the server-side logic in one file.

### Main responsibilities

- Load environment variables
- Connect to Supabase
- Seed demo users if missing
- Authenticate users with JWT
- Verify Staff ID and PIN using salted hash comparison
- Validate campus location and GPS accuracy
- Decode and validate image data
- Extract facial embeddings using DeepFace
- Compare embeddings using cosine similarity
- Issue short-lived face verification proofs
- Consume proofs for check-in/check-out
- Enforce duplicate-check-in and attendance-session rules
- Serve admin dashboard and attendance data

### Authentication model

The app uses a bearer token pattern:

- User logs in with staff_id and pin
- Backend validates the account
- Backend creates a JWT token with the user’s staff_id and role
- Protected routes require the Authorization header

---

## 7. Frontend overview

The frontend application is in [frontend/src/App.tsx](./frontend/src/App.tsx). It is a single-page React app with multiple screens and states.

### Screens implemented

- Login screen
- Staff attendance verification screen
- Admin dashboard
- Staff management screen
- Attendance history screen

### Frontend behavior

- Starts with a login form
- Calls /auth/login when the user submits credentials
- Stores access token in local UI state
- For staff users:
  - loads attendance history
  - shows live camera preview
  - verifies face
  - gets GPS location
  - submits check-in/check-out request
- For admin users:
  - loads dashboard data
  - creates staff accounts
  - resets pins
  - toggles active/inactive status
  - enrolls face data
  - fetches attendance history

---

## 8. Key environment variables

The app expects variables in [backend/.env](./backend/.env) before the backend runs.

Example values:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
JWT_SECRET_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET

CAMPUS_LATITUDE=26.8230484
CAMPUS_LONGITUDE=75.8667870
CAMPUS_RADIUS_METERS=100
MAX_GPS_ACCURACY_METERS=50
```

### Meaning of the main variables

- SUPABASE_URL: database host for Supabase
- SUPABASE_SECRET_KEY: service role or secret key for backend access
- JWT_SECRET_KEY: secret used to sign JWTs
- CAMPUS_LATITUDE / CAMPUS_LONGITUDE: center point of campus geofence
- CAMPUS_RADIUS_METERS: allowed distance from campus center
- MAX_GPS_ACCURACY_METERS: maximum acceptable GPS precision error

Important:

- Do not commit secrets to Git.
- Keep .env local and protected.
- Never store secrets in frontend code.

---

## 9. Database model

The app expects Supabase tables like these:

### staff_users

Stores staff/admin account details.

Typical fields:

- staff_id
- role
- pin_salt
- pin_hash
- is_active
- created_at

### attendance

Stores attendance events.

Typical fields:

- id
- staff_id
- check_in
- check_out
- created_at

### staff_face_profiles

Stores the enrolled face embedding for each staff member.

Typical fields:

- staff_id
- embedding
- model_name
- created_by
- updated_at

### attendance_face_proofs

Stores one-time face verification proofs used for attendance checks.

Typical fields:

- proof_id
- staff_id
- action
- expires_at
- used_at

---

## 10. Security model

The project includes several security measures:

- PINs are hashed with PBKDF2-HMAC-SHA256 using a unique salt
- JWTs are used for session auth
- Admin routes use role checks
- Attendance requests require face proof and validated GPS
- Staff accounts can be activated or deactivated
- Duplicate attendance is prevented

### Important security caveats

This is still a local MVP and not a full production security system. Some things should be improved before deployment:

- no rate limiting on login attempts
- no comprehensive audit logs for admin actions
- no migration system for database schema
- no deployment-hardening for HTTPS, secrets, and network protections
- no explicit privacy retention policy for face data

---

## 11. Attendance validation flow

A successful attendance action usually follows this path:

1. User authenticates
2. User verifies face
3. User grants GPS access
4. Backend validates GPS accuracy
5. Backend checks user is inside the campus geofence
6. Backend verifies face proof is valid and unused
7. Backend checks attendance rules
8. Attendance record is saved

### GPS validation

The backend uses the Haversine formula to calculate distance between:

- the user-reported location
- the configured campus center point

If the location is outside the campus radius, attendance is rejected.

### Face validation

The backend compares:

- stored embedding from the enrolled face profile
- current embedding from a newly captured webcam image

If the distance is too large, the request is rejected.

---

## 12. Default demo credentials

The backend can seed demo accounts if they do not already exist.

Included in the code:

- STF001 / 1234
- ADM001 / 000000

These are local demo credentials and should never be used in a real deployment or public environment.

---

## 13. Running the app locally

### Backend

From the project root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r ..\requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8100
```

Then open:

- http://127.0.0.1:8100/
- http://127.0.0.1:8100/health
- http://127.0.0.1:8100/docs

### Frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5180
```

Then open:

- http://127.0.0.1:5180

---

## 14. Important runtime notes

- Backend runs on port 8100
- Frontend runs on port 5180
- Frontend base URL is currently hardcoded to http://127.0.0.1:8100
- CORS is configured for localhost:5180 and 127.0.0.1:5180
- Browser camera and GPS permissions are required
- Localhost behaves as a secure context in browsers, so it works for local testing

---

## 15. Project strengths

- Clear and practical MVP concept
- Full staff attendance workflow implemented
- Real-world combination of identity, GPS, and face verification
- Admin dashboard for operational control
- Strong local-development flow for demos and testing

---

## 16. Main weaknesses / gaps

- Secrets in environment files are not production-safe if committed
- No migration scripts for the database
- No automated tests
- Large backend logic is contained in one file
- No rate limiting or audit logging
- No deployment configuration for real-world hosting
- No explicit privacy and retention policy for sensitive biometric data

---

## 17. Summary

CampusPass is a smart campus attendance solution that combines:

- secure staff login
- face verification
- geofence-based location checks
- admin attendance oversight

It is a strong MVP and a good foundation for a real attendance system, but it needs better security, production configuration, and operational tooling before production deployment.

---

## 18. Recommended next steps

1. Move configuration to secure environment management
2. Add database migration scripts
3. Add automated tests for auth and attendance logic
4. Split backend logic into modules
5. Add rate limiting and audit logs
6. Review privacy and biometric data handling
7. Prepare production deployment settings and HTTPS enforcement

---

## 19. Useful links in the project

- [README.md](./README.md)
- [requirements.txt](./requirements.txt)
- [backend/main.py](./backend/main.py)
- [frontend/src/App.tsx](./frontend/src/App.tsx)
- [frontend/src/App.css](./frontend/src/App.css)
- [backend/.env](./backend/.env)


