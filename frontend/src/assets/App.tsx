
import { useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";

type Screen = "login" | "verify" | "admin";
type AdminSection = "overview" | "staff" | "history";
type AttendanceAction = "check-in" | "check-out";

type AttendanceRecord = {
  id: number;
  staff_id: string;
  check_in: string;
  check_out: string | null;
  created_at?: string;
};

type GPSLocation = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
};

type AdminDashboardData = {
  date: string;
  total_staff: number;
  active_staff: number;
  inactive_staff: number;
  present_today: number;
  absent_today: number;
  currently_checked_in: number;
  recent_attendance: AttendanceRecord[];
};

type StaffAccount = {
  staff_id: string;
  role: string;
  is_active: boolean;
  created_at?: string;
};

type HistoryStatus = "all" | "present" | "absent" | "checked_in";

type AttendanceHistoryRecord = {
  staff_id: string;
  status: "present" | "absent" | "checked_in";
  check_in: string | null;
  check_out: string | null;
};

type AttendanceHistoryResponse = {
  date: string;
  total: number;
  records: AttendanceHistoryRecord[];
};

type FaceVerificationResponse = {
  verified: boolean;
  proof_id: string;
  action: AttendanceAction;
  expires_at?: string;
  message?: string;
};

const API_URL = "http://127.0.0.1:8100";

function getTodayDateInputValue() {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000
  );
  return localDate.toISOString().slice(0, 10);
}

function getCurrentLocation(): Promise<GPSLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser does not support location services."));
      return;
    }

    let watchId: number | null = null;
    let finished = false;
    let best: GPSLocation | null = null;
    const startedAt = Date.now();
    const timeoutMs = 20000;
    const targetAccuracyM = 50;

    const finish = (location?: GPSLocation, error?: Error) => {
      if (finished) return;
      finished = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      if (location) resolve(location);
      else reject(error ?? new Error("Unable to get your location. Please try again."));
    };

    const timer = window.setTimeout(() => {
      if (best) {
        // Send the best measured reading; the backend still enforces its own accuracy limit.
        finish(best);
      } else {
        finish(undefined, new Error("No GPS reading received within 20 seconds. Check browser location permission and try again."));
      }
    }, timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const candidate: GPSLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy,
        };
        if (!best || candidate.accuracy_m < best.accuracy_m) best = candidate;
        // Stop early once a high-quality reading is available.
        if (candidate.accuracy_m <= targetAccuracyM) finish(candidate);
        // Keep collecting readings for the full window when accuracy is poor.
        if (Date.now() - startedAt >= timeoutMs && best) finish(best);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          finish(undefined, new Error("Location permission denied. Allow location access for this site."));
        } else if (error.code === error.TIMEOUT) {
          if (best) finish(best);
          else finish(undefined, new Error("Getting your location took too long. Try again with location services enabled."));
        } else {
          if (best) finish(best);
          else finish(undefined, new Error("Unable to get a GPS reading. Try outdoors and enable device location services."));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [adminSection, setAdminSection] =
    useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [apiStatus, setApiStatus] = useState("Checking...");
  const [accessToken, setAccessToken] = useState("");

  // Staff attendance
  const [attendanceRecords, setAttendanceRecords] = useState<
    AttendanceRecord[]
  >([]);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [pendingAttendanceAction, setPendingAttendanceAction] =
    useState<AttendanceAction | null>(null);

  // Face-verification proof
  const [faceProof, setFaceProof] = useState("");
  const [faceProofAction, setFaceProofAction] =
    useState<AttendanceAction | null>(null);

  // Admin dashboard
  const [adminData, setAdminData] =
    useState<AdminDashboardData | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");

  // Attendance history
  const [historyDate, setHistoryDate] = useState(
    getTodayDateInputValue()
  );
  const [historyStaffId, setHistoryStaffId] = useState("");
  const [historyStatus, setHistoryStatus] =
    useState<HistoryStatus>("all");
  const [historyData, setHistoryData] =
    useState<AttendanceHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // Staff management
  const [staffList, setStaffList] = useState<StaffAccount[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState("");
  const [staffMessage, setStaffMessage] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);

  const [newStaffId, setNewStaffId] = useState("");
  const [newStaffPin, setNewStaffPin] = useState("");
  const [resetStaffId, setResetStaffId] = useState("");
  const [resetPin, setResetPin] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Face enrollment
  const [enrollingStaffId, setEnrollingStaffId] =
    useState<string | null>(null);
  const [enrollCameraError, setEnrollCameraError] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState("");
  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);

  async function checkBackend() {
    try {
      const response = await fetch(`${API_URL}/health`);

      if (!response.ok) {
        throw new Error("Backend returned an error.");
      }

      const data = await response.json();
      setApiStatus(data.status === "healthy" ? "Connected" : "Unknown");
    } catch {
      setApiStatus("Disconnected");
    }
  }

  useEffect(() => {
    void checkBackend();
  }, []);

  // Staff attendance camera
  useEffect(() => {
    if (screen !== "verify") return;

    let stream: MediaStream | null = null;
    let cancelled = false;
    let videoElement: HTMLVideoElement | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Camera access is unavailable. Open CampusPass using localhost or 127.0.0.1."
        );
        return;
      }

      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });

        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = cameraStream;
        videoElement = videoRef.current;

        if (videoElement) {
          videoElement.srcObject = cameraStream;
          await videoElement.play().catch(() => undefined);
        }

        setCameraError("");
      } catch (error) {
        console.error("CampusPass camera error:", error);

        if (!cancelled) {
          setCameraError(
            "Unable to access the camera. Allow camera permission and check that no other app is using it."
          );
        }
      }
    }

    setCameraError("");
    void startCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());

      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
  }, [screen]);

  // Face-enrollment camera lifecycle
  useEffect(() => {
    if (!enrollingStaffId || screen !== "admin") return;

    let stream: MediaStream | null = null;
    let cancelled = false;
    let videoElement: HTMLVideoElement | null = null;

    async function startEnrollmentCamera() {
      setEnrollCameraError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setEnrollCameraError(
          "Camera access is unavailable. Open CampusPass using localhost or 127.0.0.1."
        );
        return;
      }

      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });

        if (cancelled) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = cameraStream;
        videoElement = enrollVideoRef.current;

        if (videoElement) {
          videoElement.srcObject = cameraStream;
          await videoElement.play().catch(() => undefined);
        }
      } catch (error) {
        console.error("CampusPass enrollment camera error:", error);

        if (!cancelled) {
          setEnrollCameraError(
            error instanceof Error
              ? error.message
              : "Unable to access the enrollment camera. Check camera permissions."
          );
        }
      }
    }

    void startEnrollmentCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());

      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
  }, [enrollingStaffId, screen]);

  async function loadAttendance(token: string) {
    const response = await fetch(`${API_URL}/attendance/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not load attendance history.");
    }

    const records: AttendanceRecord[] = Array.isArray(data)
      ? data
      : data.records ?? data.attendance ?? [];

    setAttendanceRecords(records);
  }

  async function loadAdminDashboard(token: string) {
    setAdminLoading(true);
    setAdminError("");

    try {
      const response = await fetch(`${API_URL}/admin/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to load admin dashboard.");
      }

      setAdminData(data as AdminDashboardData);
    } catch (error) {
      console.error("CampusPass dashboard error:", error);
      setAdminError(
        error instanceof Error
          ? error.message
          : "Unable to load admin dashboard."
      );
    } finally {
      setAdminLoading(false);
    }
  }

  async function loadStaff(token: string) {
    setStaffLoading(true);
    setStaffError("");

    try {
      const response = await fetch(`${API_URL}/admin/staff`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to load staff accounts.");
      }

      setStaffList(Array.isArray(data.staff) ? data.staff : []);
    } catch (error) {
      console.error("CampusPass staff loading error:", error);
      setStaffError(
        error instanceof Error
          ? error.message
          : "Unable to load staff accounts."
      );
    } finally {
      setStaffLoading(false);
    }
  }

  async function loadAttendanceHistory(token: string) {
    if (!historyDate) {
      setHistoryError("Please select an attendance date.");
      return;
    }

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const params = new URLSearchParams();
      params.set("selected_date", historyDate);
      params.set("status", historyStatus);

      if (historyStaffId.trim()) {
        params.set("staff_id", historyStaffId.trim().toUpperCase());
      }

      const response = await fetch(
        `${API_URL}/admin/attendance/history?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Unable to load attendance history."
        );
      }

      setHistoryData(data as AttendanceHistoryResponse);
    } catch (error) {
      console.error("CampusPass history error:", error);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to load attendance history."
      );
      setHistoryData(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (screen === "admin" && accessToken) {
      void loadAdminDashboard(accessToken);
      void loadStaff(accessToken);
      void loadAttendanceHistory(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, accessToken]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setAttendanceMessage("");
    setAdminError("");
    setAdminData(null);
    setStaffError("");
    setStaffMessage("");
    setStaffList([]);
    setHistoryData(null);
    setHistoryError("");
    setFaceProof("");
    setFaceProofAction(null);

    if (!staffId.trim() || !pin.trim()) {
      setMessage("Please enter your Staff ID and PIN.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: staffId.trim(), pin }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.detail || "Login failed.");
        return;
      }

      if (!data.access_token) {
        setMessage(
          "Login succeeded, but the backend did not return an access token."
        );
        return;
      }

      setAccessToken(data.access_token);
      setAttendanceRecords([]);
      setPin("");

      if (data.role === "admin") {
        setAdminSection("overview");
        setScreen("admin");
      } else if (data.role === "staff") {
        setScreen("verify");

        try {
          await loadAttendance(data.access_token);
        } catch (error) {
          console.error("Attendance history error:", error);
          setAttendanceMessage(
            error instanceof Error
              ? error.message
              : "Could not load attendance history."
          );
        }
      } else {
        setAccessToken("");
        setMessage("This account has an unrecognized role.");
      }
    } catch (error) {
      console.error("CampusPass login error:", error);
      setMessage(
        "Cannot connect to the backend. Check that FastAPI is running."
      );
    }
  }

  async function verifyFaceForAction(
    action: AttendanceAction
  ): Promise<string> {
    if (!accessToken) {
      throw new Error("Please log in again to continue.");
    }

    const video = videoRef.current;

    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      throw new Error(
        "Camera is not ready. Allow camera access and try again."
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to capture the camera image.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.85);

    setAttendanceMessage("Verifying your face...");

    const response = await fetch(`${API_URL}/face/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ image, action }),
    });

    const responseText = await response.text();

    let data: Partial<FaceVerificationResponse> & { detail?: string };

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error(
        `Unexpected face-verification response (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : `Face verification failed (HTTP ${response.status}).`
      );
    }

    if (
      data.verified !== true ||
      typeof data.proof_id !== "string" ||
      data.action !== action
    ) {
      throw new Error(
        "The server did not return a valid face-verification proof."
      );
    }

    setFaceProof(data.proof_id);
    setFaceProofAction(action);
    return data.proof_id;
  }

  async function handleAttendance(action: AttendanceAction) {
    if (!accessToken) {
      setAttendanceMessage("Please log in again to continue.");
      handleLogout();
      return;
    }

    if (attendanceBusy) return;

    setAttendanceBusy(true);
    setAttendanceMessage("");

    let proof = faceProofAction === action ? faceProof : "";

    try {
      if (!proof) {
        proof = await verifyFaceForAction(action);
      }

      setAttendanceMessage("Face verified. Getting your GPS location...");
      const location = await getCurrentLocation();

      const response = await fetch(`${API_URL}/attendance/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ...location, face_proof: proof }),
      });

      const responseText = await response.text();

      let data: {
        detail?: string;
        message?: string;
        location?: { distance_m?: number };
      };

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          `Unexpected server response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : `Attendance failed (HTTP ${response.status}).`;

        const normalized = detail.toLowerCase();

        if (response.status === 401) {
          setAttendanceMessage(
            "Your session has expired. Please log in again."
          );
          handleLogout();
          return;
        }

        if (
          normalized.includes("outside the campus") ||
          normalized.includes("outside campus")
        ) {
          setAttendanceMessage(
            "You are outside the campus area. Please reach the college to mark attendance."
          );
        } else if (normalized.includes("accuracy")) {
          setAttendanceMessage(
            "Your GPS accuracy is too low. Move to an open area and try again."
          );
        } else {
          setAttendanceMessage(detail);
        }

        if (
          response.status === 403 ||
          response.status === 409 ||
          normalized.includes("proof") ||
          normalized.includes("face verification")
        ) {
          setFaceProof("");
          setFaceProofAction(null);
        }

        return;
      }

      setFaceProof("");
      setFaceProofAction(null);

      const distance = data.location?.distance_m;

      setAttendanceMessage(
        `${data.message || "Attendance recorded successfully."}${
          distance !== undefined
            ? ` Distance from campus pin: ${distance} metres.`
            : ""
        }`
      );

      await loadAttendance(accessToken);
    } catch (error) {
      console.error(`CampusPass ${action} error:`, error);
      setFaceProof("");
      setFaceProofAction(null);

      setAttendanceMessage(
        error instanceof Error
          ? error.message
          : "Attendance request failed. Please try again."
      );
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function handleCreateStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStaffMessage("");
    setStaffError("");

    const cleanId = newStaffId.trim().toUpperCase();

    if (!cleanId || !newStaffPin) {
      setStaffError("Enter a Staff ID and an initial PIN.");
      return;
    }

    if (!/^\d{4,12}$/.test(newStaffPin)) {
      setStaffError("PIN must contain 4 to 12 digits.");
      return;
    }

    setStaffBusy(true);

    try {
      const response = await fetch(`${API_URL}/admin/staff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ staff_id: cleanId, pin: newStaffPin }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Unable to create staff account."
        );
      }

      setStaffMessage(`Staff account ${cleanId} created successfully.`);
      setNewStaffId("");
      setNewStaffPin("");

      await loadStaff(accessToken);
      await loadAdminDashboard(accessToken);
    } catch (error) {
      setStaffError(
        error instanceof Error
          ? error.message
          : "Unable to create staff account."
      );
    } finally {
      setStaffBusy(false);
    }
  }

  async function handleResetPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStaffMessage("");
    setStaffError("");

    const cleanId = resetStaffId.trim().toUpperCase();

    if (!cleanId || !resetPin) {
      setStaffError("Select a Staff ID and enter the new PIN.");
      return;
    }

    if (!/^\d{4,12}$/.test(resetPin)) {
      setStaffError("PIN must contain 4 to 12 digits.");
      return;
    }

    setStaffBusy(true);

    try {
      const response = await fetch(
        `${API_URL}/admin/staff/${encodeURIComponent(cleanId)}/pin`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ pin: resetPin }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to reset PIN.");
      }

      setStaffMessage(`PIN reset successfully for ${cleanId}.`);
      setResetStaffId("");
      setResetPin("");
    } catch (error) {
      setStaffError(
        error instanceof Error ? error.message : "Unable to reset PIN."
      );
    } finally {
      setStaffBusy(false);
    }
  }

  async function handleToggleStaff(staff: StaffAccount) {
    const nextStatus = !staff.is_active;
    const action = nextStatus ? "activate" : "deactivate";

    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${staff.staff_id}?`
    );

    if (!confirmed) return;

    setStaffBusy(true);
    setStaffMessage("");
    setStaffError("");

    try {
      const response = await fetch(
        `${API_URL}/admin/staff/${encodeURIComponent(staff.staff_id)}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ is_active: nextStatus }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Unable to update account status.");
      }

      setStaffMessage(
        `${staff.staff_id} has been ${
          nextStatus ? "activated" : "deactivated"
        }.`
      );

      await loadStaff(accessToken);
      await loadAdminDashboard(accessToken);
    } catch (error) {
      setStaffError(
        error instanceof Error
          ? error.message
          : "Unable to update account status."
      );
    } finally {
      setStaffBusy(false);
    }
  }

  function openFaceEnrollment(staff: StaffAccount) {
    if (!staff.is_active || staffBusy || enrollBusy) return;

    setEnrollCameraError("");
    setEnrollMessage("");
    setEnrollingStaffId(staff.staff_id);
  }

  function closeFaceEnrollment() {
    if (enrollBusy) return;

    setEnrollingStaffId(null);
    setEnrollCameraError("");
    setEnrollMessage("");
  }

  async function handleEnrollFace() {
    if (!accessToken || !enrollingStaffId || enrollBusy) return;

    const video = enrollVideoRef.current;

    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setEnrollCameraError(
        "Camera is not ready. Wait for the preview and try again."
      );
      return;
    }

    setEnrollBusy(true);
    setEnrollMessage("");
    setEnrollCameraError("");

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to capture the camera image.");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.9);

      const response = await fetch(
        `${API_URL}/admin/staff/${encodeURIComponent(enrollingStaffId)}/face`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ image }),
        }
      );

      const responseText = await response.text();
      let data: { detail?: string; message?: string } = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          `Unexpected server response (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.detail ||
            `Face enrollment failed (HTTP ${response.status}).`
        );
      }

      setStaffMessage(
        `Face enrolled successfully for ${enrollingStaffId}.`
      );
      setEnrollMessage(
        `Face enrollment completed for ${enrollingStaffId}.`
      );
      setEnrollingStaffId(null);
    } catch (error) {
      setEnrollCameraError(
        error instanceof Error
          ? error.message
          : "Face enrollment failed. Please try again."
      );
    } finally {
      setEnrollBusy(false);
    }
  }

  function handleLogout() {
    setEnrollingStaffId(null);
    setEnrollCameraError("");
    setEnrollMessage("");
    setEnrollBusy(false);

    setAccessToken("");
    setAttendanceRecords([]);
    setAttendanceMessage("");
    setPendingAttendanceAction(null);
    setAttendanceBusy(false);
    setFaceProof("");
    setFaceProofAction(null);
    setCameraError("");
    setAdminData(null);
    setAdminError("");
    setStaffList([]);
    setStaffError("");
    setStaffMessage("");
    setNewStaffId("");
    setNewStaffPin("");
    setResetStaffId("");
    setResetPin("");
    setHistoryData(null);
    setHistoryError("");
    setHistoryStaffId("");
    setHistoryStatus("all");
    setHistoryDate(getTodayDateInputValue());
    setMessage("");
    setPin("");
    setAdminSection("overview");
    setSidebarOpen(false);
    setScreen("login");
  }

  function formatDateTime(value: string | null) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const pageTitles: Record<AdminSection, string> = {
    overview: "Dashboard overview",
    staff: "Staff management",
    history: "Attendance history",
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="mobile-menu-button"
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>

        <button
          className="brand"
          type="button"
          onClick={() => {
            if (screen !== "login") handleLogout();
          }}
        >
          <span className="brand-icon">CP</span>
          <span>
            <strong>CampusPass</strong>
            <small>Secure staff attendance</small>
          </span>
        </button>

        <div className="top-actions">
          <span
            className={`status-dot ${
              apiStatus === "Connected" ? "status-online" : "status-offline"
            }`}
          />
          <span className="api-status">API: {apiStatus}</span>

          <button
            className="outline-button"
            type="button"
            onClick={() => void checkBackend()}
          >
            Test API
          </button>
        </div>
      </header>

      {screen === "login" && (
        <main className="main-content">
          <section className="login-layout">
            <div className="intro-panel">
              <span className="eyebrow">SMART CAMPUS ACCESS</span>
              <h1>
                Attendance,
                <br />
                made smarter.
              </h1>
              <p>
                A secure attendance experience designed around staff
                identity, campus location, and reliable records.
              </p>

              <div className="feature-list">
                <div><span>01</span> Staff identity verification</div>
                <div><span>02</span> Camera-based face matching</div>
                <div><span>03</span> Location-aware attendance</div>
              </div>
            </div>

            <form className="login-card" onSubmit={handleLogin}>
              <div className="card-symbol">CP</div>
              <h2>Welcome back</h2>
              <p className="muted">Enter your staff details to continue.</p>

              <label htmlFor="staffId">Staff ID</label>
              <input
                id="staffId"
                value={staffId}
                onChange={(event) => setStaffId(event.target.value)}
                placeholder="e.g. STF001"
                autoComplete="username"
                required
              />

              <label htmlFor="pin">PIN</label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder="Enter your PIN"
                autoComplete="current-password"
                required
              />

              {message && <p className="error-message" role="alert">{message}</p>}

              <button className="primary-button" type="submit">
                Sign in <span>→</span>
              </button>

              <p className="demo-note">Use your registered CampusPass account.</p>
            </form>
          </section>
        </main>
      )}

      {screen === "verify" && (
        <main className="main-content">
          <section className="workflow-card">
            <button className="text-button" type="button" onClick={handleLogout}>
              ← Log out
            </button>

            <span className="eyebrow">STAFF ATTENDANCE</span>
            <h1>Welcome, {staffId}</h1>
            <p className="muted">
              Your face and campus location must be verified before attendance is recorded.
            </p>

            <div className="camera-placeholder">
              {cameraError ? (
                <div className="camera-error">
                  <strong>Camera unavailable</strong>
                  <p>{cameraError}</p>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => {
                      setCameraError("");
                      setScreen("login");
                      window.setTimeout(() => setScreen("verify"), 0);
                    }}
                  >
                    Try camera again
                  </button>
                </div>
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />
                  <strong>Live camera preview</strong>
                  <p>
                    Your camera image will be checked against your enrolled face profile when you confirm attendance.
                  </p>
                </>
              )}
            </div>

            <div className="challenge-box">
              <span className="eyebrow">FACE VERIFICATION</span>
              <h2>Look directly at the camera</h2>
              <p className="muted">
                Keep your face clearly visible in good lighting. Face matching runs when you confirm check-in or check-out.
              </p>
            </div>

            <div className="button-row">
              <button
                className="primary-button"
                type="button"
                disabled={attendanceBusy || !!cameraError}
                onClick={() => {
                  setAttendanceMessage("");
                  setPendingAttendanceAction("check-in");
                }}
              >
                {attendanceBusy ? "Please wait..." : "Check in"}
              </button>
              <button
                className="outline-button"
                type="button"
                disabled={attendanceBusy || !!cameraError}
                onClick={() => {
                  setAttendanceMessage("");
                  setPendingAttendanceAction("check-out");
                }}
              >
                {attendanceBusy ? "Please wait..." : "Check out"}
              </button>
            </div>

            {!attendanceBusy && !pendingAttendanceAction && (
              <p className="muted">Ready to record attendance. Select Check in or Check out.</p>
            )}

            {attendanceMessage && (
              <div
                className={`attendance-alert ${
                  /outside the campus|not accurate|accuracy is too low|failed|unable|denied|too long|cannot connect|error|gps signal|could not|not enrolled|not ready|expired|rejected|must be/i.test(attendanceMessage)
                    ? "alert-error"
                    : "alert-success"
                }`}
                role="status"
                aria-live="polite"
              >
                <span>{attendanceMessage}</span>
              </div>
            )}

            <div className="table-card">
              <div className="admin-heading">
                <div>
                  <h2>My attendance history</h2>
                  <p className="muted">Records saved in the CampusPass database.</p>
                </div>
                <button
                  className="outline-button"
                  type="button"
                  disabled={attendanceBusy}
                  onClick={async () => {
                    setAttendanceMessage("");
                    try {
                      await loadAttendance(accessToken);
                      setAttendanceMessage("Attendance history refreshed.");
                    } catch (error) {
                      setAttendanceMessage(
                        error instanceof Error ? error.message : "Could not refresh attendance."
                      );
                    }
                  }}
                >
                  Refresh
                </button>
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Check-in</th><th>Check-out</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {attendanceRecords.length === 0 ? (
                      <tr><td colSpan={3}>No attendance records found.</td></tr>
                    ) : attendanceRecords.map((record, index) => (
                      <tr key={record.id ?? index}>
                        <td>{formatDateTime(record.check_in)}</td>
                        <td>{formatDateTime(record.check_out)}</td>
                        <td>
                          <span className={`badge ${record.check_out ? "verified" : "gps-only"}`}>
                            {record.check_out ? "Completed" : "Checked in"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      )}

      {screen === "admin" && (
        <div className="admin-layout">
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              className="sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
            <div className="sidebar-heading">
              <span className="sidebar-section-label">WORKSPACE</span>
            </div>

            <nav className="sidebar-nav" aria-label="Admin navigation">
              <button
                type="button"
                className={`nav-item ${adminSection === "overview" ? "active" : ""}`}
                onClick={() => { setAdminSection("overview"); setSidebarOpen(false); }}
              >
                <span className="nav-icon">▦</span><span>Dashboard</span>
              </button>
              <button
                type="button"
                className={`nav-item ${adminSection === "staff" ? "active" : ""}`}
                onClick={() => { setAdminSection("staff"); setSidebarOpen(false); }}
              >
                <span className="nav-icon">♙</span><span>Staff management</span>
              </button>
              <button
                type="button"
                className={`nav-item ${adminSection === "history" ? "active" : ""}`}
                onClick={() => { setAdminSection("history"); setSidebarOpen(false); }}
              >
                <span className="nav-icon">▤</span><span>Attendance history</span>
              </button>
            </nav>

            <div className="sidebar-bottom">
              <div className="sidebar-help">
                <span className="help-icon">i</span>
                <div><strong>Need help?</strong><p>Contact your system administrator.</p></div>
              </div>
              <button type="button" className="sidebar-logout" onClick={handleLogout}>
                <span>↪</span> Sign out
              </button>
            </div>
          </aside>

          <main className="admin-main">
            <div className="admin-topline">
              <div>
                <span className="breadcrumb">CampusPass / Admin</span>
                <h1>{pageTitles[adminSection]}</h1>
              </div>
              <div className="admin-top-actions">
                <span className={`connection-label ${apiStatus === "Connected" ? "connected" : "disconnected"}`}>
                  <span className="status-dot" />{apiStatus}
                </span>
                <button
                  className="outline-button"
                  type="button"
                  disabled={adminLoading || staffLoading}
                  onClick={() => {
                    void loadAdminDashboard(accessToken);
                    void loadStaff(accessToken);
                    void loadAttendanceHistory(accessToken);
                  }}
                >
                  {adminLoading || staffLoading ? "Refreshing..." : "↻ Refresh"}
                </button>
              </div>
            </div>

            {adminError && <div className="error-message" role="alert">{adminError}</div>}

            {adminSection === "overview" && (
              <>
                <div className="welcome-banner">
                  <div>
                    <span className="eyebrow">YOUR CAMPUS AT A GLANCE</span>
                    <h2>Good to see you, Admin.</h2>
                    <p>Here is the latest attendance summary{adminData ? ` for ${adminData.date}` : ""}.</p>
                  </div>
                  <div className="welcome-mark">CP</div>
                </div>

                <div className="section-heading">
                  <div><h2>Attendance overview</h2><p>Key workforce statistics for today.</p></div>
                  <span className="date-chip">{adminData?.date || historyDate}</span>
                </div>

                <div className="stats-grid">
                  <div className="stat-card stat-blue"><div className="stat-top"><span>Total staff</span><span className="stat-icon">♙</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.total_staff ?? 0}</strong><small>All registered accounts</small></div>
                  <div className="stat-card stat-green"><div className="stat-top"><span>Present today</span><span className="stat-icon">✓</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.present_today ?? 0}</strong><small>Staff who checked in</small></div>
                  <div className="stat-card stat-orange"><div className="stat-top"><span>Absent today</span><span className="stat-icon">◷</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.absent_today ?? 0}</strong><small>Not yet marked present</small></div>
                  <div className="stat-card stat-purple"><div className="stat-top"><span>Currently checked in</span><span className="stat-icon">↗</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.currently_checked_in ?? 0}</strong><small>Open attendance sessions</small></div>
                  <div className="stat-card stat-teal"><div className="stat-top"><span>Active staff</span><span className="stat-icon">●</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.active_staff ?? 0}</strong><small>Accounts with access</small></div>
                  <div className="stat-card stat-red"><div className="stat-top"><span>Inactive staff</span><span className="stat-icon">⊘</span></div><strong>{adminLoading && !adminData ? "—" : adminData?.inactive_staff ?? 0}</strong><small>Deactivated accounts</small></div>
                </div>

                <div className="table-card">
                  <div className="admin-heading">
                    <div><h2>Recent attendance</h2><p className="muted">Latest records returned by the dashboard API.</p></div>
                    <button className="outline-button" type="button" onClick={() => { setAdminSection("history"); void loadAttendanceHistory(accessToken); }}>View all records →</button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead><tr><th>Staff ID</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead>
                      <tbody>
                        {!adminData?.recent_attendance?.length ? (
                          <tr><td colSpan={4}>{adminLoading ? "Loading recent attendance..." : "No recent attendance records."}</td></tr>
                        ) : adminData.recent_attendance.map((record) => (
                          <tr key={record.id}>
                            <td>{record.staff_id}</td><td>{formatDateTime(record.check_in)}</td><td>{formatDateTime(record.check_out)}</td>
                            <td><span className={`badge ${record.check_out ? "verified" : "gps-only"}`}>{record.check_out ? "Completed" : "Checked in"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {adminSection === "staff" && (
              <div className="table-card">
                <div className="admin-heading">
                  <div>
                    <span className="eyebrow">ACCOUNT MANAGEMENT</span>
                    <h2>Manage staff accounts</h2>
                    <p className="muted">Create accounts, reset PINs, and control account access.</p>
                  </div>
                  <button className="outline-button" type="button" disabled={staffLoading || staffBusy} onClick={() => void loadStaff(accessToken)}>
                    {staffLoading ? "Loading..." : "Refresh staff"}
                  </button>
                </div>

                {staffError && <p className="error-message" role="alert">{staffError}</p>}
                {staffMessage && <p className="success-message" role="status">{staffMessage}</p>}

                <div className="staff-forms-grid">
                  <form className="staff-form" onSubmit={handleCreateStaff}>
                    <h3>Add staff account</h3>
                    <p className="muted">Create a new staff login with a unique ID.</p>
                    <label htmlFor="newStaffId">New Staff ID</label>
                    <input id="newStaffId" value={newStaffId} onChange={(event) => setNewStaffId(event.target.value)} placeholder="e.g. STF002" minLength={3} maxLength={30} required />
                    <label htmlFor="newStaffPin">Initial PIN</label>
                    <input id="newStaffPin" type="password" inputMode="numeric" value={newStaffPin} onChange={(event) => setNewStaffPin(event.target.value)} placeholder="4–12 digit PIN" minLength={4} maxLength={12} pattern="[0-9]{4,12}" autoComplete="new-password" required />
                    <button className="primary-button" type="submit" disabled={staffBusy}>{staffBusy ? "Please wait..." : "Create account"}</button>
                  </form>

                  <form className="staff-form" onSubmit={handleResetPin}>
                    <h3>Reset staff PIN</h3>
                    <p className="muted">Set a new PIN for an existing account.</p>
                    <label htmlFor="resetStaffId">Staff account</label>
                    <select id="resetStaffId" value={resetStaffId} onChange={(event) => setResetStaffId(event.target.value)} required>
                      <option value="">Select a staff account</option>
                      {staffList.map((staff) => <option key={staff.staff_id} value={staff.staff_id}>{staff.staff_id}{staff.is_active ? "" : " (Inactive)"}</option>)}
                    </select>
                    <label htmlFor="resetPin">New PIN</label>
                    <input id="resetPin" type="password" inputMode="numeric" value={resetPin} onChange={(event) => setResetPin(event.target.value)} placeholder="4–12 digit PIN" minLength={4} maxLength={12} pattern="[0-9]{4,12}" autoComplete="new-password" required />
                    <button className="primary-button" type="submit" disabled={staffBusy}>{staffBusy ? "Please wait..." : "Reset PIN"}</button>
                  </form>
                </div>

                <div className="section-heading staff-list-heading">
                  <div><h2>Registered staff</h2><p>Manage account status and enroll staff face profiles.</p></div>
                  <span className="date-chip">{staffList.length} accounts</span>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff ID</th>
                        <th>Account status</th>
                        <th>Created</th>
                        <th>Face enrollment</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffLoading && staffList.length === 0 ? (
                        <tr><td colSpan={5}>Loading staff accounts...</td></tr>
                      ) : staffList.length === 0 ? (
                        <tr><td colSpan={5}>No staff accounts found.</td></tr>
                      ) : (
                        staffList.map((staff) => (
                          <tr key={staff.staff_id}>
                            <td>{staff.staff_id}</td>
                            <td>
                              <span className={`badge ${staff.is_active ? "verified" : "gps-only"}`}>
                                {staff.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>{staff.created_at ? formatDateTime(staff.created_at) : "—"}</td>
                            <td>
                              <button
                                className="primary-button"
                                type="button"
                                disabled={staffBusy || !staff.is_active || !!enrollingStaffId}
                                onClick={() => openFaceEnrollment(staff)}
                              >
                                Enroll face
                              </button>
                            </td>
                            <td>
                              <button className="outline-button" type="button" disabled={staffBusy} onClick={() => void handleToggleStaff(staff)}>
                                {staff.is_active ? "Deactivate" : "Activate"}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminSection === "history" && (
              <div className="table-card">
                <div className="admin-heading">
                  <div>
                    <span className="eyebrow">ATTENDANCE RECORDS</span>
                    <h2>Attendance history</h2>
                    <p className="muted">Search records by date, staff ID, and status.</p>
                  </div>
                </div>

                <form className="history-filters" onSubmit={(event) => { event.preventDefault(); void loadAttendanceHistory(accessToken); }}>
                  <div className="staff-form">
                    <label htmlFor="historyDate">Attendance date</label>
                    <input id="historyDate" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} required />
                  </div>
                  <div className="staff-form">
                    <label htmlFor="historyStaffId">Staff ID (optional)</label>
                    <input id="historyStaffId" value={historyStaffId} onChange={(event) => setHistoryStaffId(event.target.value)} placeholder="e.g. STF001" />
                  </div>
                  <div className="staff-form">
                    <label htmlFor="historyStatus">Status</label>
                    <select id="historyStatus" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as HistoryStatus)}>
                      <option value="all">All statuses</option>
                      <option value="present">Present</option>
                      <option value="absent">Absent</option>
                      <option value="checked_in">Checked in</option>
                    </select>
                  </div>
                  <div className="staff-form filter-action">
                    <label>Search records</label>
                    <button className="primary-button" type="submit" disabled={historyLoading || !historyDate}>
                      {historyLoading ? "Loading..." : "Apply filters"}
                    </button>
                  </div>
                </form>

                {historyError && <p className="error-message" role="alert">{historyError}</p>}
                {historyData && <div className="results-summary"><strong>{historyData.total} records</strong><span>Attendance for {historyData.date}</span></div>}

                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Staff ID</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead>
                    <tbody>
                      {historyLoading ? (
                        <tr><td colSpan={4}>Loading attendance history...</td></tr>
                      ) : !historyData ? (
                        <tr><td colSpan={4}>{historyError ? "Could not load attendance records." : "No results loaded yet."}</td></tr>
                      ) : historyData.records.length === 0 ? (
                        <tr><td colSpan={4}>No records match the selected filters.</td></tr>
                      ) : historyData.records.map((record) => (
                        <tr key={record.staff_id}>
                          <td>{record.staff_id}</td><td>{formatDateTime(record.check_in)}</td><td>{formatDateTime(record.check_out)}</td>
                          <td>
                            <span className={`badge ${record.status === "present" ? "verified" : record.status === "checked_in" ? "gps-only" : ""}`}>
                              {record.status === "checked_in" ? "Checked in" : record.status === "present" ? "Present" : "Absent"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="history-footer">
                  <button className="outline-button" type="button" disabled={historyLoading} onClick={() => void loadAttendanceHistory(accessToken)}>
                    ↻ Refresh results
                  </button>
                </div>
              </div>
            )}

            <footer className="admin-footer">
              CampusPass · Project prototype
              <span>Identity · Location · Trust</span>
            </footer>
          </main>
        </div>
      )}

      {/* Face enrollment dialog */}
      {enrollingStaffId && screen === "admin" && (
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !enrollBusy) {
              closeFaceEnrollment();
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enroll-title"
            aria-describedby="enroll-description"
          >
            <span className="eyebrow">STAFF FACE ENROLLMENT</span>
            <h2 id="enroll-title">Enroll {enrollingStaffId}</h2>
            <p id="enroll-description">
              Make sure the correct staff member is in view. Their face should be clearly visible, well lit, and facing the camera. Only enroll a person with their knowledge and consent.
            </p>

            <div style={{ width: "100%", overflow: "hidden", borderRadius: "12px", background: "#111827", margin: "16px 0" }}>
              <video
                ref={enrollVideoRef}
                autoPlay
                playsInline
                muted
                aria-label="Face enrollment camera preview"
                style={{ display: "block", width: "100%", maxHeight: "320px", minHeight: "180px", objectFit: "cover" }}
              />
            </div>

            {enrollCameraError && <p className="error-message" role="alert">{enrollCameraError}</p>}
            {enrollMessage && <p className="success-message" role="status">{enrollMessage}</p>}

            <div className="confirm-actions">
              <button type="button" className="outline-button" disabled={enrollBusy} onClick={closeFaceEnrollment}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={enrollBusy || !!enrollCameraError}
                onClick={() => void handleEnrollFace()}
              >
                {enrollBusy ? "Enrolling..." : "Capture and enroll"}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingAttendanceAction && (
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !attendanceBusy) {
              setPendingAttendanceAction(null);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
          >
            <div className={`confirm-icon ${pendingAttendanceAction === "check-in" ? "confirm-icon-in" : "confirm-icon-out"}`} aria-hidden="true">
              {pendingAttendanceAction === "check-in" ? "↗" : "↙"}
            </div>
            <span className="eyebrow">ATTENDANCE CONFIRMATION</span>
            <h2 id="confirm-title">
              Confirm your {pendingAttendanceAction === "check-in" ? "check-in" : "check-out"}?
            </h2>
            <p id="confirm-description">
              {pendingAttendanceAction === "check-in"
                ? "Your face will be verified before marking today's attendance."
                : "Your face will be verified before ending your current attendance session."}
            </p>
            <div className="confirm-notice">
              <span aria-hidden="true">ⓘ</span>
              <p>
                The live camera image and GPS location will be checked. Attendance is recorded only if face verification, campus location, and GPS accuracy requirements pass.
              </p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="outline-button" disabled={attendanceBusy} onClick={() => setPendingAttendanceAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={attendanceBusy || !pendingAttendanceAction}
                onClick={() => {
                  const action = pendingAttendanceAction;
                  if (!action || attendanceBusy) return;
                  setPendingAttendanceAction(null);
                  void handleAttendance(action);
                }}
              >
                {attendanceBusy ? "Please wait..." : `Yes, ${pendingAttendanceAction === "check-in" ? "check in" : "check out"}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
