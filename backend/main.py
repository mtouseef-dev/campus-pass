import os
import hashlib
import hmac
import secrets
import math
import base64
import binascii
import uuid

import numpy as np
import cv2
from deepface import DeepFace

from datetime import datetime, timedelta, timezone, date as Date
from contextlib import asynccontextmanager

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from supabase import create_client, Client


load_dotenv()

supabase: Client | None = None

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 480

CAMPUS_LATITUDE = float(os.getenv("CAMPUS_LATITUDE", "26.822625"))
CAMPUS_LONGITUDE = float(os.getenv("CAMPUS_LONGITUDE", "75.866351"))
CAMPUS_RADIUS_METERS = float(os.getenv("CAMPUS_RADIUS_METERS", "200"))
MAX_GPS_ACCURACY_METERS = float(
    os.getenv("MAX_GPS_ACCURACY_METERS", "50")
)

FACE_MODEL_NAME = os.getenv("FACE_MODEL_NAME", "Facenet512")
FACE_DISTANCE_THRESHOLD = float(
    os.getenv("FACE_DISTANCE_THRESHOLD", "0.30")
)
FACE_PROOF_VALID_SECONDS = 90
MAX_FACE_IMAGE_BYTES = 1_500_000

INDIA_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
bearer_scheme = HTTPBearer(auto_error=False)


# ---------------- SECURITY HELPERS ----------------

def hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        salt.encode("utf-8"),
        200_000,
    ).hex()


def haversine_distance(
    latitude1: float,
    longitude1: float,
    latitude2: float,
    longitude2: float,
) -> float:
    earth_radius = 6_371_000

    lat1 = math.radians(latitude1)
    lat2 = math.radians(latitude2)
    lat_difference = math.radians(latitude2 - latitude1)
    lon_difference = math.radians(longitude2 - longitude1)

    a = (
        math.sin(lat_difference / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(lon_difference / 2) ** 2
    )

    a = min(1.0, max(0.0, a))

    return earth_radius * 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a),
    )


class GPSLocation(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(gt=0, le=10000)


class AttendanceRequest(GPSLocation):
    face_proof: str = Field(min_length=1, max_length=100)


class FaceImageRequest(BaseModel):
    image: str = Field(min_length=1)


class FaceVerifyRequest(BaseModel):
    image: str = Field(min_length=1)
    action: str


def validate_campus_location(location: GPSLocation) -> dict:
    if location.accuracy_m > MAX_GPS_ACCURACY_METERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Your GPS accuracy is too low "
                f"({location.accuracy_m:.0f} m). "
                f"Move to an open area and try again. "
                f"Required accuracy: "
                f"{MAX_GPS_ACCURACY_METERS:.0f} m or better."
            ),
        )

    distance = haversine_distance(
        location.latitude,
        location.longitude,
        CAMPUS_LATITUDE,
        CAMPUS_LONGITUDE,
    )

    if distance > CAMPUS_RADIUS_METERS:
        raise HTTPException(
            status_code=403,
            detail=(
                "You are outside the campus attendance area. "
                f"Distance from campus pin: {distance:.0f} metres. "
                f"Allowed distance: {CAMPUS_RADIUS_METERS:.0f} metres."
            ),
        )

    return {
        "distance_m": round(distance, 1),
        "accuracy_m": round(location.accuracy_m, 1),
    }


# ---------------- FACE RECOGNITION HELPERS ----------------

def decode_face_image(image_data: str) -> np.ndarray:
    """Decode a base64 image and validate its dimensions."""

    if image_data.startswith("data:"):
        parts = image_data.split(",", 1)

        if len(parts) != 2:
            raise HTTPException(400, "Invalid image data.")

        image_data = parts[1]

    # Reject excessively long encoded data before decoding.
    if len(image_data) > (MAX_FACE_IMAGE_BYTES * 2):
        raise HTTPException(
            413,
            "Image must be smaller than 1.5 MB.",
        )

    try:
        image_bytes = base64.b64decode(
            image_data,
            validate=True,
        )
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Invalid base64 image.")

    if not image_bytes:
        raise HTTPException(400, "Image is empty.")

    if len(image_bytes) > MAX_FACE_IMAGE_BYTES:
        raise HTTPException(
            413,
            "Image must be smaller than 1.5 MB.",
        )

    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise HTTPException(400, "Unable to read the image.")

    height, width = frame.shape[:2]

    if width < 160 or height < 160:
        raise HTTPException(
            400,
            "Image resolution must be at least 160 x 160 pixels.",
        )

    return frame


def extract_face_embedding(image_data: str) -> list[float]:
    """Extract one face embedding using DeepFace."""

    frame = decode_face_image(image_data)

    try:
        representations = DeepFace.represent(
            img_path=frame,
            model_name=FACE_MODEL_NAME,
            detector_backend="opencv",
            enforce_detection=True,
            align=True,
        )
    except Exception as error:
        print(f"Face extraction error: {error}")

        raise HTTPException(
            status_code=400,
            detail=(
                "No clear face detected. Face the camera in good "
                "lighting and try again."
            ),
        )

    if len(representations) != 1:
        raise HTTPException(
            status_code=400,
            detail="Please ensure exactly one face is visible.",
        )

    embedding = representations[0].get("embedding")

    if embedding is None:
        raise HTTPException(
            status_code=400,
            detail="Unable to extract face features.",
        )

    vector = np.asarray(embedding, dtype=np.float64)

    if vector.ndim != 1 or not np.all(np.isfinite(vector)):
        raise HTTPException(
            status_code=400,
            detail="Invalid face features detected.",
        )

    return vector.tolist()


def cosine_distance(
    first_embedding: list[float],
    second_embedding: list[float],
) -> float:
    first = np.asarray(first_embedding, dtype=np.float64)
    second = np.asarray(second_embedding, dtype=np.float64)

    if first.shape != second.shape:
        raise HTTPException(
            status_code=409,
            detail="Face model mismatch. Please enroll the face again.",
        )

    denominator = np.linalg.norm(first) * np.linalg.norm(second)

    if denominator == 0:
        raise HTTPException(
            status_code=400,
            detail="Unable to compare face features.",
        )

    similarity = float(np.dot(first, second) / denominator)
    similarity = max(-1.0, min(1.0, similarity))

    return 1.0 - similarity


def consume_face_proof(
    proof_id: str,
    staff_id: str,
    action: str,
) -> None:
    """Validate and consume a short-lived face verification proof."""

    assert supabase is not None

    now = datetime.now(timezone.utc)

    try:
        result = (
            supabase.table("attendance_face_proofs")
            .select(
                "proof_id, staff_id, action, expires_at, used_at"
            )
            .eq("proof_id", proof_id)
            .eq("staff_id", staff_id)
            .eq("action", action)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=403,
                detail="Face verification required. Verify your face again.",
            )

        proof = result.data[0]

        if proof.get("used_at") is not None:
            raise HTTPException(
                status_code=403,
                detail="This face verification has already been used.",
            )

        expiry = datetime.fromisoformat(
            proof["expires_at"].replace("Z", "+00:00")
        )

        if expiry <= now:
            raise HTTPException(
                status_code=403,
                detail="Face verification expired. Please verify again.",
            )

        # Conditional update prevents ordinary reuse of an already-used proof.
        consumed = (
            supabase.table("attendance_face_proofs")
            .update({"used_at": now.isoformat()})
            .eq("proof_id", proof_id)
            .eq("staff_id", staff_id)
            .eq("action", action)
            .is_("used_at", "null")
            .execute()
        )

        if not consumed.data:
            raise HTTPException(
                status_code=403,
                detail="This face verification has already been used.",
            )

    except HTTPException:
        raise
    except Exception as error:
        print(f"Face proof validation error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to validate face verification.",
        )


# ---------------- DATABASE INITIALIZATION ----------------

def seed_demo_users():
    """Create demo accounts only if they do not already exist."""

    assert supabase is not None

    demo_users = [
        {"staff_id": "STF001", "pin": "1234", "role": "staff"},
        {"staff_id": "ADM001", "pin": "000000", "role": "admin"},
    ]

    for demo in demo_users:
        existing = (
            supabase.table("staff_users")
            .select("staff_id")
            .eq("staff_id", demo["staff_id"])
            .limit(1)
            .execute()
        )

        if existing.data:
            continue

        salt = secrets.token_hex(16)

        supabase.table("staff_users").insert({
            "staff_id": demo["staff_id"],
            "role": demo["role"],
            "pin_salt": salt,
            "pin_hash": hash_pin(demo["pin"], salt),
        }).execute()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global supabase

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")

    if not url or not key or not JWT_SECRET_KEY:
        raise RuntimeError(
            "Check SUPABASE_URL, SUPABASE_SECRET_KEY, "
            "and JWT_SECRET_KEY in backend/.env"
        )

    if CAMPUS_RADIUS_METERS <= 0 or MAX_GPS_ACCURACY_METERS <= 0:
        raise RuntimeError(
            "Campus radius and maximum GPS accuracy must be positive."
        )

    if FACE_DISTANCE_THRESHOLD <= 0 or FACE_DISTANCE_THRESHOLD >= 2:
        raise RuntimeError(
            "FACE_DISTANCE_THRESHOLD must be greater than 0 and less than 2."
        )

    supabase = create_client(url, key)
    seed_demo_users()

    print(
        "CampusPass geofence enabled: "
        f"latitude={CAMPUS_LATITUDE}, "
        f"longitude={CAMPUS_LONGITUDE}, "
        f"radius={CAMPUS_RADIUS_METERS} metres"
    )
    print(f"Face verification enabled with model: {FACE_MODEL_NAME}")

    yield


app = FastAPI(title="CampusPass API", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://campuspass-ignite.vercel.app/",
        "http://localhost:5180",
        "http://127.0.0.1:5180",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ---------------- BASIC ROUTES ----------------

@app.get("/")
def home():
    return {
        "message": "Welcome to CampusPass",
        "status": "running",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


# ---------------- AUTHENTICATION ----------------

class LoginRequest(BaseModel):
    staff_id: str
    pin: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Please log in first",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
        )

        staff_id = payload.get("sub")

        if not staff_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid login token",
            )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Please log in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid login token",
        )

    assert supabase is not None

    try:
        result = (
            supabase.table("staff_users")
            .select("staff_id, role, is_active")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Unable to verify your account. Please try again.",
        )

    if not result.data:
        raise HTTPException(
            status_code=401,
            detail="Account not found. Please contact the administrator.",
        )

    account = result.data[0]

    if not account.get("is_active", True):
        raise HTTPException(
            status_code=403,
            detail=(
                "Your account is deactivated. "
                "Please contact the administrator."
            ),
        )

    if account.get("role") not in ("staff", "admin"):
        raise HTTPException(
            status_code=403,
            detail="This account does not have a valid role.",
        )

    return {
        "staff_id": account["staff_id"],
        "role": account["role"],
    }


@app.post("/auth/login")
def login(data: LoginRequest):
    assert supabase is not None

    try:
        result = (
            supabase.table("staff_users")
            .select("staff_id, role, pin_salt, pin_hash, is_active")
            .eq("staff_id", data.staff_id.strip().upper())
            .limit(1)
            .execute()
        )
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Unable to access the database",
        )

    if not result.data:
        raise HTTPException(
            status_code=401,
            detail="Invalid Staff ID or Security PIN",
        )

    user = result.data[0]
    submitted_hash = hash_pin(data.pin, user["pin_salt"])

    if not hmac.compare_digest(submitted_hash, user["pin_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Invalid Staff ID or Security PIN",
        )

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=403,
            detail=(
                "Your account is deactivated. "
                "Please contact the administrator."
            ),
        )

    now = datetime.now(timezone.utc)

    token = jwt.encode(
        {
            "sub": user["staff_id"],
            "role": user["role"],
            "iat": now,
            "exp": now + timedelta(minutes=TOKEN_EXPIRE_MINUTES),
        },
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )

    return {
        "message": "Login successful",
        "staff_id": user["staff_id"],
        "role": user["role"],
        "access_token": token,
        "token_type": "bearer",
        "expires_in": TOKEN_EXPIRE_MINUTES * 60,
    }


# ---------------- ADMIN ACCESS ----------------

def require_admin(user: dict = Depends(get_current_user)):
    """Allow only authenticated admin users."""

    if user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required.",
        )

    return user


# ---------------- ADMIN FACE ENROLLMENT ----------------

@app.post("/admin/staff/{staff_id}/face")
def enroll_staff_face(
    staff_id: str,
    data: FaceImageRequest,
    admin: dict = Depends(require_admin),
):
    """Enroll or replace a staff member's face profile."""

    assert supabase is not None
    normalized_id = staff_id.strip().upper()

    try:
        staff = (
            supabase.table("staff_users")
            .select("staff_id, role, is_active")
            .eq("staff_id", normalized_id)
            .eq("role", "staff")
            .limit(1)
            .execute()
        )

        if not staff.data:
            raise HTTPException(
                status_code=404,
                detail="Staff account not found.",
            )

        if not staff.data[0].get("is_active", True):
            raise HTTPException(
                status_code=403,
                detail="This staff account is inactive.",
            )

        embedding = extract_face_embedding(data.image)

        existing = (
            supabase.table("staff_face_profiles")
            .select("staff_id")
            .eq("staff_id", normalized_id)
            .limit(1)
            .execute()
        )

        profile = {
            "staff_id": normalized_id,
            "embedding": embedding,
            "model_name": FACE_MODEL_NAME,
            "created_by": admin["staff_id"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if existing.data:
            supabase.table("staff_face_profiles").update({
                "embedding": embedding,
                "model_name": FACE_MODEL_NAME,
                "created_by": admin["staff_id"],
                "updated_at": profile["updated_at"],
            }).eq("staff_id", normalized_id).execute()
        else:
            supabase.table("staff_face_profiles").insert(
                profile
            ).execute()

        return {
            "message": "Staff face enrolled successfully.",
            "staff_id": normalized_id,
            "model": FACE_MODEL_NAME,
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Face enrollment error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to enroll the face. Please try again.",
        )


@app.get("/admin/staff/{staff_id}/face-status")
def staff_face_status(
    staff_id: str,
    admin: dict = Depends(require_admin),
):
    """Check whether a staff member has an enrolled face."""

    assert supabase is not None

    normalized_id = staff_id.strip().upper()

    try:
        result = (
            supabase.table("staff_face_profiles")
            .select("staff_id, model_name, updated_at")
            .eq("staff_id", normalized_id)
            .limit(1)
            .execute()
        )

        return {
            "staff_id": normalized_id,
            "enrolled": bool(result.data),
            "profile": result.data[0] if result.data else None,
        }

    except Exception as error:
        print(f"Face status error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to check face status.",
        )


# ---------------- FACE VERIFICATION ----------------

@app.post("/face/verify")
def verify_face(
    data: FaceVerifyRequest,
    user: dict = Depends(get_current_user),
):
    """Verify the authenticated staff member and issue a temporary proof."""

    assert supabase is not None

    if data.action not in {"check-in", "check-out"}:
        raise HTTPException(
            status_code=400,
            detail="Action must be check-in or check-out.",
        )

    try:
        result = (
            supabase.table("staff_face_profiles")
            .select("embedding, model_name")
            .eq("staff_id", user["staff_id"])
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Your face is not enrolled. "
                    "Contact the administrator."
                ),
            )

        profile = result.data[0]

        if profile["model_name"] != FACE_MODEL_NAME:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Face model changed. Ask the administrator "
                    "to enroll your face again."
                ),
            )

        current_embedding = extract_face_embedding(data.image)

        distance = cosine_distance(
            profile["embedding"],
            current_embedding,
        )

        if distance > FACE_DISTANCE_THRESHOLD:
            raise HTTPException(
                status_code=403,
                detail="Face verification failed. Please try again.",
            )

        proof_id = str(uuid.uuid4())
        expiry = datetime.now(timezone.utc) + timedelta(
            seconds=FACE_PROOF_VALID_SECONDS
        )

        supabase.table("attendance_face_proofs").insert({
            "proof_id": proof_id,
            "staff_id": user["staff_id"],
            "action": data.action,
            "expires_at": expiry.isoformat(),
        }).execute()

        return {
            "verified": True,
            "proof_id": proof_id,
            "action": data.action,
            "expires_at": expiry.isoformat(),
            "message": (
                "Face verified. Complete attendance within "
                f"{FACE_PROOF_VALID_SECONDS} seconds."
            ),
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Face verification error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to verify your face. Please try again.",
        )


# ---------------- ATTENDANCE CHECK-IN ----------------

@app.post("/attendance/check-in")
def check_in(
    location: AttendanceRequest,
    user: dict = Depends(get_current_user),
):
    assert supabase is not None

    gps_result = validate_campus_location(location)
    staff_id = user["staff_id"]

    # Consume proof only after GPS validation succeeds.
    consume_face_proof(
        location.face_proof,
        staff_id,
        "check-in",
    )

    now_ist = datetime.now(INDIA_TIMEZONE)
    start_of_day = now_ist.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    end_of_day = start_of_day + timedelta(days=1)

    try:
        existing = (
            supabase.table("attendance")
            .select("id, check_in, check_out")
            .eq("staff_id", staff_id)
            .gte("check_in", start_of_day.astimezone(timezone.utc).isoformat())
            .lt("check_in", end_of_day.astimezone(timezone.utc).isoformat())
            .limit(1)
            .execute()
        )

        if existing.data:
            record = existing.data[0]

            if record.get("check_out") is None:
                detail = "You are already checked in."
            else:
                detail = (
                    "You have already recorded attendance today. "
                    "You cannot check in again today."
                )

            raise HTTPException(status_code=409, detail=detail)

        result = (
            supabase.table("attendance")
            .insert({
                "staff_id": staff_id,
                "check_in": datetime.now(timezone.utc).isoformat(),
            })
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=503,
                detail="The attendance record could not be saved.",
            )

        return {
            "message": "Check-in successful. Campus location accepted.",
            "attendance": result.data[0],
            "location": gps_result,
            "face_verified": True,
        }

    except HTTPException:
        raise
    except Exception as error:
        error_text = str(error)
        print(f"Check-in error: {error_text}")

        if (
            "23505" in error_text
            or "attendance_one_session_per_staff_per_day" in error_text
            or "attendance_one_open_session_per_staff" in error_text
        ):
            raise HTTPException(
                status_code=409,
                detail="Attendance has already been recorded today.",
            )

        raise HTTPException(
            status_code=503,
            detail="Check-in failed. Please try again.",
        )


# ---------------- ATTENDANCE CHECK-OUT ----------------

@app.post("/attendance/check-out")
def check_out(
    location: AttendanceRequest,
    user: dict = Depends(get_current_user),
):
    assert supabase is not None

    gps_result = validate_campus_location(location)
    staff_id = user["staff_id"]

    consume_face_proof(
        location.face_proof,
        staff_id,
        "check-out",
    )

    try:
        active = (
            supabase.table("attendance")
            .select("id")
            .eq("staff_id", staff_id)
            .is_("check_out", "null")
            .order("check_in", desc=True)
            .limit(1)
            .execute()
        )

        if not active.data:
            raise HTTPException(
                status_code=409,
                detail="You are not currently checked in.",
            )

        record_id = active.data[0]["id"]

        result = (
            supabase.table("attendance")
            .update({
                "check_out": datetime.now(timezone.utc).isoformat()
            })
            .eq("id", record_id)
            .eq("staff_id", staff_id)
            .is_("check_out", "null")
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=409,
                detail="This attendance record is already closed.",
            )

        return {
            "message": "Check-out successful. Campus location accepted.",
            "attendance": result.data[0],
            "location": gps_result,
            "face_verified": True,
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Check-out error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to save check-out. Please try again.",
        )


# ---------------- MY ATTENDANCE ----------------

@app.get("/attendance/me")
def my_attendance(user: dict = Depends(get_current_user)):
    assert supabase is not None

    try:
        result = (
            supabase.table("attendance")
            .select("id, staff_id, check_in, check_out, created_at")
            .eq("staff_id", user["staff_id"])
            .order("check_in", desc=True)
            .limit(100)
            .execute()
        )

        return {
            "staff_id": user["staff_id"],
            "records": result.data or [],
        }

    except Exception as error:
        print(f"Attendance history error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to load attendance history.",
        )


# ---------------- ADMIN DASHBOARD ----------------

@app.get("/admin/dashboard")
def admin_dashboard(user: dict = Depends(require_admin)):
    assert supabase is not None

    try:
        now_ist = datetime.now(INDIA_TIMEZONE)

        start_ist = now_ist.replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        end_ist = start_ist + timedelta(days=1)

        start_utc = start_ist.astimezone(timezone.utc).isoformat()
        end_utc = end_ist.astimezone(timezone.utc).isoformat()

        staff_result = (
            supabase.table("staff_users")
            .select("staff_id, role, is_active")
            .eq("role", "staff")
            .execute()
        )

        staff_accounts = staff_result.data or []

        all_staff_ids = {
            item["staff_id"] for item in staff_accounts
        }

        active_staff_ids = {
            item["staff_id"]
            for item in staff_accounts
            if item.get("is_active", True)
        }

        total_staff = len(all_staff_ids)
        active_staff = len(active_staff_ids)
        inactive_staff = total_staff - active_staff

        today_result = (
            supabase.table("attendance")
            .select("id, staff_id, check_in, check_out")
            .gte("check_in", start_utc)
            .lt("check_in", end_utc)
            .order("check_in", desc=True)
            .execute()
        )

        today_records = today_result.data or []

        active_today_records = [
            record for record in today_records
            if record["staff_id"] in active_staff_ids
        ]

        present_ids = {
            record["staff_id"] for record in active_today_records
        }

        present_today = len(present_ids)
        absent_today = max(0, active_staff - present_today)

        open_result = (
            supabase.table("attendance")
            .select("staff_id")
            .is_("check_out", "null")
            .execute()
        )

        checked_in_ids = {
            record["staff_id"]
            for record in (open_result.data or [])
            if record["staff_id"] in active_staff_ids
        }

        return {
            "date": now_ist.date().isoformat(),
            "total_staff": total_staff,
            "active_staff": active_staff,
            "inactive_staff": inactive_staff,
            "present_today": present_today,
            "absent_today": absent_today,
            "currently_checked_in": len(checked_in_ids),
            "recent_attendance": today_records[:10],
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Admin dashboard error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to load admin dashboard data.",
        )


# ---------------- STAFF MANAGEMENT ----------------

class CreateStaffRequest(BaseModel):
    staff_id: str
    pin: str


class ResetStaffPinRequest(BaseModel):
    pin: str


class StaffStatusRequest(BaseModel):
    is_active: bool


def validate_staff_pin(pin: str):
    if not pin.isdigit() or not 4 <= len(pin) <= 12:
        raise HTTPException(
            status_code=400,
            detail="PIN must contain 4 to 12 digits.",
        )


@app.get("/admin/staff")
def list_staff(user: dict = Depends(require_admin)):
    assert supabase is not None

    try:
        result = (
            supabase.table("staff_users")
            .select("staff_id, role, is_active, created_at")
            .eq("role", "staff")
            .order("staff_id")
            .execute()
        )

        return {"staff": result.data or []}

    except Exception as error:
        print(f"List staff error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to load staff accounts.",
        )


@app.post("/admin/staff")
def create_staff(
    data: CreateStaffRequest,
    user: dict = Depends(require_admin),
):
    assert supabase is not None

    staff_id = data.staff_id.strip().upper()
    pin = data.pin.strip()

    if not staff_id or not all(
        character.isalnum() or character == "_"
        for character in staff_id
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Staff ID can contain only letters, numbers, "
                "and underscores."
            ),
        )

    validate_staff_pin(pin)

    try:
        existing = (
            supabase.table("staff_users")
            .select("staff_id")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            raise HTTPException(
                status_code=409,
                detail="This Staff ID already exists.",
            )

        salt = secrets.token_hex(16)

        supabase.table("staff_users").insert({
            "staff_id": staff_id,
            "role": "staff",
            "pin_salt": salt,
            "pin_hash": hash_pin(pin, salt),
            "is_active": True,
        }).execute()

        return {
            "message": "Staff account created successfully.",
            "staff_id": staff_id,
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Create staff error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to create staff account.",
        )


@app.patch("/admin/staff/{staff_id}/pin")
def reset_staff_pin(
    staff_id: str,
    data: ResetStaffPinRequest,
    user: dict = Depends(require_admin),
):
    assert supabase is not None

    pin = data.pin.strip()
    validate_staff_pin(pin)
    normalized_id = staff_id.strip().upper()

    try:
        result = (
            supabase.table("staff_users")
            .select("staff_id, role")
            .eq("staff_id", normalized_id)
            .eq("role", "staff")
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Staff account not found.",
            )

        salt = secrets.token_hex(16)

        supabase.table("staff_users").update({
            "pin_salt": salt,
            "pin_hash": hash_pin(pin, salt),
        }).eq("staff_id", normalized_id).execute()

        return {
            "message": "Staff PIN reset successfully.",
            "staff_id": normalized_id,
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Reset staff PIN error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to reset staff PIN.",
        )


@app.patch("/admin/staff/{staff_id}/status")
def update_staff_status(
    staff_id: str,
    data: StaffStatusRequest,
    user: dict = Depends(require_admin),
):
    assert supabase is not None
    normalized_id = staff_id.strip().upper()

    try:
        existing = (
            supabase.table("staff_users")
            .select("staff_id, role")
            .eq("staff_id", normalized_id)
            .eq("role", "staff")
            .limit(1)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Staff account not found.",
            )

        supabase.table("staff_users").update({
            "is_active": data.is_active,
        }).eq("staff_id", normalized_id).execute()

        return {
            "message": (
                "Staff account activated successfully."
                if data.is_active
                else "Staff account deactivated successfully."
            ),
            "staff_id": normalized_id,
            "is_active": data.is_active,
        }

    except HTTPException:
        raise
    except Exception as error:
        print(f"Update staff status error: {error}")
        raise HTTPException(
            status_code=503,
            detail="Unable to update staff status.",
        )


# ---------------- ADMIN ATTENDANCE HISTORY ----------------

@app.get("/admin/attendance/history")
def get_attendance_history(
    selected_date: Date = Query(
        ...,
        description="Attendance date in YYYY-MM-DD format",
    ),
    staff_id: str | None = Query(default=None),
    status: str = Query(default="all"),
    current_user: dict = Depends(get_current_user),
):
    require_admin(current_user)
    assert supabase is not None

    if status not in {"all", "present", "absent", "checked_in"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid status. Use all, present, absent, or checked_in.",
        )

    start_of_day = datetime(
        selected_date.year,
        selected_date.month,
        selected_date.day,
        tzinfo=INDIA_TIMEZONE,
    )
    end_of_day = start_of_day + timedelta(days=1)

    staff_response = (
        supabase.table("staff_users")
        .select("staff_id, role, is_active")
        .execute()
    )

    staff_members = [
        staff
        for staff in (staff_response.data or [])
        if staff.get("role") == "staff"
        and staff.get("is_active", True)
    ]

    if staff_id and staff_id.strip():
        normalized_id = staff_id.strip().upper()
        staff_members = [
            staff for staff in staff_members
            if staff["staff_id"].upper() == normalized_id
        ]

    attendance_response = (
        supabase.table("attendance")
        .select("id, staff_id, check_in, check_out")
        .gte(
            "check_in",
            start_of_day.astimezone(timezone.utc).isoformat(),
        )
        .lt(
            "check_in",
            end_of_day.astimezone(timezone.utc).isoformat(),
        )
        .order("check_in", desc=True)
        .execute()
    )

    attendance_by_staff = {}

    for record in attendance_response.data or []:
        attendance_by_staff.setdefault(record["staff_id"], record)

    results = []

    for staff in staff_members:
        record = attendance_by_staff.get(staff["staff_id"])

        if record:
            record_status = (
                "checked_in"
                if record.get("check_out") is None
                else "present"
            )
        else:
            record_status = "absent"

        if status != "all" and record_status != status:
            continue

        results.append({
            "staff_id": staff["staff_id"],
            "status": record_status,
            "check_in": record.get("check_in") if record else None,
            "check_out": record.get("check_out") if record else None,
        })

    return {
        "date": selected_date.isoformat(),
        "total": len(results),
        "records": results,
    }