<script>
  import { onDestroy, tick } from "svelte";
  import QRCode from "qrcode";
  import logoBarrancas from "../logobarrancas.png";
  import waiverIsoEs from "../waiverISOesp.png";
  import waiverIsoEn from "../WaiverISOingles.png";
  import WaiverTextEditor from "./components/WaiverTextEditor.svelte";
  import WaiverTextView from "./components/WaiverTextView.svelte";
  import { isWaiverTextEmpty } from "./lib/waiverHtml.js";
  import {
    NATIONALITIES,
    MEXICO_STATES,
    citiesForState,
    buildCityStateLabel
  } from "./lib/locationOptions.js";
  import { collectWaiverFieldErrors } from "./lib/waiverFormValidation.js";
  import { getMessages, NATIONALITY_EN } from "./lib/i18n.js";
  import { WAIVER_TEXT_EN_HTML } from "./lib/waiverTextEn.js";

  const API_BASE = "/api";
  const savedLocale = localStorage.getItem("waiverLocale");
  let locale = savedLocale === "en" ? "en" : "es";
  let path = window.location.pathname;
  let query = new URLSearchParams(window.location.search);
  let loading = false;
  let message = "";
  let qrCanvas;
  let signatureCanvas;
  let signatureHasStroke = false;
  let guardianSignatureCanvas;
  let guardianSignatureHasStroke = false;
  let guardianModalOpen = false;
  let witnessSignatureCanvas;
  let witnessSignatureHasStroke = false;

  let authToken = localStorage.getItem("authToken") || "";
  let authUser = JSON.parse(localStorage.getItem("authUser") || "null");

  let attractions = [];
  let selectedAttractionId = "";
  let selectedAttraction = null;
  let waiverResult = null;
  let checkData = null;
  let paymentSuccessInFlight = false;

  let staffScanPaste = "";
  let staffScanResult = null;
  let staffScanBusy = false;
  let staffScanError = "";
  let staffScanRunning = false;
  let staffScanVideoEl;
  let staffScanStream = null;
  let staffScanRaf = 0;
  let staffScanDetector = null;

  let loginForm = { email: "", password: "" };
  let adminAttractions = [];
  let adminUsers = [];
  let report = { summary: null, byAttraction: [], waivers: [] };
  let adminReport = { items: [], total: 0, page: 1, pageSize: 25, summary: null };
  let adminReportFilters = { attractionId: "", from: "", to: "", status: "", q: "" };
  let adminAttractionEditId = "";
  let editWaiverText = "";
  let editAttractionDescription = "";
  let editStripeEnabled = false;
  let newUser = { name: "", email: "", password: "", role: "staff" };
  let newAttraction = { name: "", code: "", description: "", waiverText: "", active: true, stripeEnabled: false };
  let waiverEditorKey = 0;
  let showAdminLogin = false;
  let adminTab = "new-attraction";

let form = {
  fullName: "",
  birthDate: "",
  gender: "",
  phone: "",
  email: "",
  nationality: "",
  cityState: "",
  medications: "",
  treatingPhysician: "",
  physicianPhone: "",
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
  familyReference2Name: "",
  familyReference2Relationship: "",
  familyReference2Phone: "",
  hasMedicalCondition: false,
  consumedAlcoholOrDrugs: false,
  acceptsSafetyRules: true,
  acceptedText: false
};
  let guardian = {
    fullName: "",
    relation: "",
    phone: "",
    email: ""
  };
  /** Firma tutor persistida al cerrar el modal (el canvas se destruye al ocultarlo). */
  let guardianSignaturePng = "";
  let takesMedications = "";
  let selectedNationality = "México";
  let selectedState = "";
  let selectedCity = "";
  let customCity = "";
  let foreignCityState = "";
  let fieldErrors = {};
  let showFieldErrors = false;

  $: availableCities = citiesForState(selectedState);
  $: L = getMessages(locale);
  $: isPublicWaiverUi =
    !path.startsWith("/check/") && path !== "/staff" && path !== "/admin";
  $: displayWaiverText =
    locale === "en" ? WAIVER_TEXT_EN_HTML : selectedAttraction?.waiverText || "";
  $: isMexico = selectedNationality === "México";

  function setLocale(next) {
    if (next !== "en" && next !== "es") return;
    locale = next;
    localStorage.setItem("waiverLocale", next);
    document.documentElement.lang = next === "en" ? "en" : "es";
  }

  function getAge(birthDateString) {
    if (!birthDateString) return null;
    const birthDate = new Date(birthDateString);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
    return age;
  }

  $: participantAge = getAge(form.birthDate);
  $: isMinor = participantAge !== null && participantAge < 18;
  $: requiresStripePayment = selectedAttraction?.stripeEnabled === true;

  function signaturePad(node) {
    const ctx = node.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f4a3b";

    let drawing = false;
    let activeTouchId = null;
    const docTouchOpts = { capture: true, passive: false };

    function pointFromClient(clientX, clientY) {
      const rect = node.getBoundingClientRect();
      const sx = node.width / rect.width;
      const sy = node.height / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    function touchById(list, id) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    }

    function detachGlobalTouch() {
      document.removeEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.removeEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      activeTouchId = null;
      drawing = false;
    }

    function onDocumentTouchMove(event) {
      if (!drawing || activeTouchId === null) return;
      const t = touchById(event.touches, activeTouchId);
      if (!t) return;
      event.preventDefault();
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      signatureHasStroke = true;
    }

    function onDocumentTouchEnd(event) {
      if (!drawing || activeTouchId === null) return;
      const ended = [...(event.changedTouches || [])].some((ch) => ch.identifier === activeTouchId);
      if (!ended) return;
      event.preventDefault();
      detachGlobalTouch();
    }

    function startMouse(event) {
      event.preventDefault();
      drawing = true;
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function moveMouse(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      signatureHasStroke = true;
    }

    function endMouse() {
      drawing = false;
    }

    function startTouch(event) {
      event.preventDefault();
      if (drawing && activeTouchId !== null) return;
      const t = event.changedTouches[0];
      if (!t) return;
      activeTouchId = t.identifier;
      drawing = true;
      document.addEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.addEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.addEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    node.addEventListener("mousedown", startMouse);
    node.addEventListener("mousemove", moveMouse);
    window.addEventListener("mouseup", endMouse);
    node.addEventListener("touchstart", startTouch, { passive: false });

    return {
      destroy() {
        detachGlobalTouch();
        node.removeEventListener("mousedown", startMouse);
        node.removeEventListener("mousemove", moveMouse);
        window.removeEventListener("mouseup", endMouse);
        node.removeEventListener("touchstart", startTouch);
      }
    };
  }

  function guardianSignaturePad(node) {
    const ctx = node.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f4a3b";

    let drawing = false;
    let activeTouchId = null;
    const docTouchOpts = { capture: true, passive: false };

    function pointFromClient(clientX, clientY) {
      const rect = node.getBoundingClientRect();
      const sx = node.width / rect.width;
      const sy = node.height / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    function touchById(list, id) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    }

    function detachGlobalTouch() {
      document.removeEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.removeEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      activeTouchId = null;
      drawing = false;
    }

    function onDocumentTouchMove(event) {
      if (!drawing || activeTouchId === null) return;
      const t = touchById(event.touches, activeTouchId);
      if (!t) return;
      event.preventDefault();
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      guardianSignatureHasStroke = true;
    }

    function onDocumentTouchEnd(event) {
      if (!drawing || activeTouchId === null) return;
      const ended = [...(event.changedTouches || [])].some((ch) => ch.identifier === activeTouchId);
      if (!ended) return;
      event.preventDefault();
      detachGlobalTouch();
    }

    function startMouse(event) {
      event.preventDefault();
      drawing = true;
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function moveMouse(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      guardianSignatureHasStroke = true;
    }

    function endMouse() {
      drawing = false;
    }

    function startTouch(event) {
      event.preventDefault();
      if (drawing && activeTouchId !== null) return;
      const t = event.changedTouches[0];
      if (!t) return;
      activeTouchId = t.identifier;
      drawing = true;
      document.addEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.addEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.addEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    node.addEventListener("mousedown", startMouse);
    node.addEventListener("mousemove", moveMouse);
    window.addEventListener("mouseup", endMouse);
    node.addEventListener("touchstart", startTouch, { passive: false });

    return {
      destroy() {
        detachGlobalTouch();
        node.removeEventListener("mousedown", startMouse);
        node.removeEventListener("mousemove", moveMouse);
        window.removeEventListener("mouseup", endMouse);
        node.removeEventListener("touchstart", startTouch);
      }
    };
  }

  function clearSignature() {
    if (!signatureCanvas) return;
    const ctx = signatureCanvas.getContext("2d");
    ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signatureHasStroke = false;
  }

  function clearGuardianSignature() {
    guardianSignaturePng = "";
    guardianSignatureHasStroke = false;
    if (!guardianSignatureCanvas) return;
    const ctx = guardianSignatureCanvas.getContext("2d");
    ctx.clearRect(0, 0, guardianSignatureCanvas.width, guardianSignatureCanvas.height);
  }

  function witnessSignaturePad(node) {
    const ctx = node.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f4a3b";

    let drawing = false;
    let activeTouchId = null;
    const docTouchOpts = { capture: true, passive: false };

    function pointFromClient(clientX, clientY) {
      const rect = node.getBoundingClientRect();
      const sx = node.width / rect.width;
      const sy = node.height / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    function touchById(list, id) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    }

    function detachGlobalTouch() {
      document.removeEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.removeEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      activeTouchId = null;
      drawing = false;
    }

    function onDocumentTouchMove(event) {
      if (!drawing || activeTouchId === null) return;
      const t = touchById(event.touches, activeTouchId);
      if (!t) return;
      event.preventDefault();
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      witnessSignatureHasStroke = true;
    }

    function onDocumentTouchEnd(event) {
      if (!drawing || activeTouchId === null) return;
      const ended = [...(event.changedTouches || [])].some((ch) => ch.identifier === activeTouchId);
      if (!ended) return;
      event.preventDefault();
      detachGlobalTouch();
    }

    function startMouse(event) {
      event.preventDefault();
      drawing = true;
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function moveMouse(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pointFromClient(event.clientX, event.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      witnessSignatureHasStroke = true;
    }

    function endMouse() {
      drawing = false;
    }

    function startTouch(event) {
      event.preventDefault();
      if (drawing && activeTouchId !== null) return;
      const t = event.changedTouches[0];
      if (!t) return;
      activeTouchId = t.identifier;
      drawing = true;
      document.addEventListener("touchmove", onDocumentTouchMove, docTouchOpts);
      document.addEventListener("touchend", onDocumentTouchEnd, { capture: true });
      document.addEventListener("touchcancel", onDocumentTouchEnd, { capture: true });
      const p = pointFromClient(t.clientX, t.clientY);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    node.addEventListener("mousedown", startMouse);
    node.addEventListener("mousemove", moveMouse);
    window.addEventListener("mouseup", endMouse);
    node.addEventListener("touchstart", startTouch, { passive: false });

    return {
      destroy() {
        detachGlobalTouch();
        node.removeEventListener("mousedown", startMouse);
        node.removeEventListener("mousemove", moveMouse);
        window.removeEventListener("mouseup", endMouse);
        node.removeEventListener("touchstart", startTouch);
      }
    };
  }

  function clearWitnessSignature() {
    witnessSignatureHasStroke = false;
    if (!witnessSignatureCanvas) return;
    const ctx = witnessSignatureCanvas.getContext("2d");
    ctx.clearRect(0, 0, witnessSignatureCanvas.width, witnessSignatureCanvas.height);
  }

  function saveGuardianModal() {
    const hasStoredPng =
      typeof guardianSignaturePng === "string" &&
      guardianSignaturePng.startsWith("data:image/png;base64,");
    if (guardianSignatureCanvas && guardianSignatureHasStroke) {
      guardianSignaturePng = guardianSignatureCanvas.toDataURL("image/png");
    } else if (!hasStoredPng) {
      message = L.guardianSigRequired;
      return;
    }
    guardianModalOpen = false;
  }

  function resetRegistrationFlow() {
    waiverResult = null;
    message = "";
    localStorage.removeItem("pendingWaiverDraftKey");
    localStorage.removeItem("pendingWaiverPayload");
    form = {
      fullName: "",
      birthDate: "",
      gender: "",
      phone: "",
      email: "",
      nationality: "",
      cityState: "",
      medications: "",
      treatingPhysician: "",
      physicianPhone: "",
      emergencyContactName: "",
      emergencyContactRelationship: "",
      emergencyContactPhone: "",
      familyReference2Name: "",
      familyReference2Relationship: "",
      familyReference2Phone: "",
      hasMedicalCondition: false,
      consumedAlcoholOrDrugs: false,
      acceptsSafetyRules: true,
      acceptedText: false
    };
    guardian = {
      fullName: "",
      relation: "",
      phone: "",
      email: ""
    };
    guardianSignaturePng = "";
    guardianModalOpen = false;
    takesMedications = "";
    selectedNationality = "México";
    selectedState = "";
    selectedCity = "";
    customCity = "";
    foreignCityState = "";
    fieldErrors = {};
    showFieldErrors = false;
    clearSignature();
    clearGuardianSignature();
    clearWitnessSignature();
    window.location.reload();
  }

  function fieldInvalid(key) {
    return showFieldErrors && fieldErrors[key];
  }

  function onLocationStateChange() {
    selectedCity = "";
    customCity = "";
  }

  function syncParticipantLocationFields() {
    form.nationality = selectedNationality;
    form.cityState = buildCityStateLabel({
      nationality: selectedNationality,
      state: selectedState,
      city: selectedCity,
      customCity,
      foreignCityState
    });
  }

  function prepareMedicationFields() {
    if (takesMedications === "no") {
      form.medications = "No";
      form.treatingPhysician = "";
      form.physicianPhone = "";
      return;
    }
    if (takesMedications === "yes" && !form.medications.trim()) {
      form.medications = "";
    }
  }

  function validateWaiverForm() {
    syncParticipantLocationFields();
    prepareMedicationFields();
    fieldErrors = collectWaiverFieldErrors({
      form,
      selectedAttractionId,
      takesMedications,
      selectedNationality,
      selectedState,
      selectedCity,
      customCity,
      foreignCityState
    });
    return Object.keys(fieldErrors).length === 0;
  }

  function hasRequiredGuardianFields() {
    const hasPng =
      typeof guardianSignaturePng === "string" &&
      guardianSignaturePng.startsWith("data:image/png;base64,");
    return (
      !!guardian.fullName.trim() &&
      !!guardian.relation.trim() &&
      !!guardian.phone.trim() &&
      !!guardian.email.trim() &&
      hasPng
    );
  }

  function goTo(url) {
    history.pushState({}, "", url);
    path = window.location.pathname;
    query = new URLSearchParams(window.location.search);
    bootstrap();
  }

  window.addEventListener("popstate", () => {
    path = window.location.pathname;
    query = new URLSearchParams(window.location.search);
    bootstrap();
  });

  function authHeaders() {
    return authToken ? { authorization: `Bearer ${authToken}` } : {};
  }

  async function api(url, method = "GET", payload) {
  const r = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { "content-type": "application/json", ...authHeaders() },
    body: payload ? JSON.stringify(payload) : undefined
  });

  const contentType = r.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await r.json() : await r.text();

  if (!r.ok) {
    if (isJson && data?.error) throw new Error(data.error);
    throw new Error(typeof data === "string" ? data : "Error");
  }

  return data;
}

  async function loadPublicAttractions() {
    attractions = await api("/public/attractions");
    if (!selectedAttractionId && attractions.length) selectedAttractionId = attractions[0]._id;
    selectedAttraction = attractions.find((a) => a._id === selectedAttractionId) || null;
  }

  let waiverSubmitInFlight = false;

  async function submitWaiver() {
    if (waiverSubmitInFlight) return;
    waiverSubmitInFlight = true;
    loading = true;
    message = "";
    showFieldErrors = true;
    if (!validateWaiverForm()) {
      waiverSubmitInFlight = false;
      loading = false;
      message = L.reviewFields;
      return;
    }
    if (!signatureHasStroke || !signatureCanvas) {
      waiverSubmitInFlight = false;
      loading = false;
      fieldErrors = { ...fieldErrors, signatureImage: true };
      message = L.participantSigRequired;
      return;
    }
    if (!witnessSignatureHasStroke || !witnessSignatureCanvas) {
      waiverSubmitInFlight = false;
      loading = false;
      fieldErrors = { ...fieldErrors, witnessSignatureImage: true };
      message = L.witnessSigRequired;
      return;
    }
    if (isMinor && !hasRequiredGuardianFields()) {
      waiverSubmitInFlight = false;
      loading = false;
      guardianModalOpen = true;
      message = L.minorGuardianRequired;
      return;
    }
    try {
      const signatureImage = signatureCanvas.toDataURL("image/png");
      const witnessSignatureImage = witnessSignatureCanvas.toDataURL("image/png");
      const guardianSignatureImage =
        guardianSignaturePng || guardianSignatureCanvas?.toDataURL("image/png");

      const pendingWaiverPayload = {
        attractionId: selectedAttractionId,
        participant: {
          fullName: form.fullName,
          birthDate: form.birthDate,
          gender: form.gender,
          phone: form.phone,
          email: form.email,
          nationality: form.nationality,
          cityState: form.cityState,
          medications: form.medications,
          treatingPhysician: form.treatingPhysician,
          physicianPhone: form.physicianPhone,
          emergencyContactName: form.emergencyContactName,
          emergencyContactRelationship: form.emergencyContactRelationship,
          emergencyContactPhone: form.emergencyContactPhone,
          familyReference2Name: form.familyReference2Name,
          familyReference2Relationship: form.familyReference2Relationship,
          familyReference2Phone: form.familyReference2Phone
        },
        answers: {
          hasMedicalCondition: form.hasMedicalCondition,
          consumedAlcoholOrDrugs: form.consumedAlcoholOrDrugs,
          acceptsSafetyRules: form.acceptsSafetyRules
        },
        acceptedText: form.acceptedText,
        signatureName: form.fullName,
        signatureImage,
        witness: { signatureImage: witnessSignatureImage },
        guardian: isMinor
          ? {
              fullName: guardian.fullName,
              relation: guardian.relation,
              phone: guardian.phone,
              email: guardian.email,
              signatureImage: guardianSignatureImage
            }
          : undefined,
        locale: locale === "en" ? "en" : "es"
      };

      if (requiresStripePayment) {
        const { draftKey } = await api("/public/waiver-drafts", "POST", pendingWaiverPayload);
        localStorage.setItem("pendingWaiverDraftKey", draftKey);

        const checkout = await api("/public/create-checkout-session", "POST", {
          amount: 3000,
          successPath: "/success",
          cancelPath: "/cancel",
          draftKey
        });

        if (!checkout?.url) {
          throw new Error("No se recibió la URL de pago.");
        }

        window.location.href = checkout.url;
        return;
      }

      waiverResult = await api("/public/waivers", "POST", pendingWaiverPayload);
      await tick();
      if (!qrCanvas) await tick();
      if (waiverResult?.qrUrl && qrCanvas) {
        try {
          await QRCode.toCanvas(qrCanvas, waiverResult.qrUrl);
        } catch {
          /* mismo comportamiento silencioso si el canvas falla */
        }
      }
    } catch (e) {
      message = e.message;
    } finally {
      waiverSubmitInFlight = false;
      loading = false;
    }
  }

  async function finalizeSuccessfulPayment() {
  if (paymentSuccessInFlight) return;
  paymentSuccessInFlight = true;
  loading = true;
  message = "";

  try {
    const draftKey = query.get("draft") || localStorage.getItem("pendingWaiverDraftKey");
    let payload;
    if (draftKey) {
      payload = await api("/public/waiver-drafts/read", "POST", { draftKey });
    } else {
      const raw = localStorage.getItem("pendingWaiverPayload");
      if (!raw) {
        message = "El pago se completó, pero no se encontró la información del waiver para finalizarlo.";
        return;
      }
      payload = JSON.parse(raw);
      localStorage.removeItem("pendingWaiverPayload");
    }

    waiverResult = await api("/public/waivers", "POST", payload);
    if (draftKey) {
      try {
        await api("/public/waiver-drafts/release", "POST", { draftKey });
      } catch {
        /* el borrador caduca solo; no bloquear al usuario */
      }
      localStorage.removeItem("pendingWaiverDraftKey");
    }

    await tick();
    if (!qrCanvas) await tick();
    if (waiverResult?.qrUrl && qrCanvas) {
      try {
        await QRCode.toCanvas(qrCanvas, waiverResult.qrUrl);
      } catch {
        /* mismo comportamiento silencioso si el canvas falla */
      }
    }

    history.replaceState({}, "", "/");
    path = window.location.pathname;
    query = new URLSearchParams(window.location.search);
  } catch (e) {
    message = e.message;
  } finally {
    loading = false;
    paymentSuccessInFlight = false;
  }
}

async function handleCancelledPayment() {
  message = L.paymentCancelled;
  const dk = localStorage.getItem("pendingWaiverDraftKey");
  if (dk) {
    try {
      await api("/public/waiver-drafts/release", "POST", { draftKey: dk });
    } catch {
      /* ignorar */
    }
  }
  localStorage.removeItem("pendingWaiverDraftKey");
  localStorage.removeItem("pendingWaiverPayload");
  history.replaceState({}, "", "/");
  path = window.location.pathname;
  query = new URLSearchParams(window.location.search);
}

  function saveAuth(token, user) {
    authToken = token;
    authUser = user;
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", JSON.stringify(user));
  }

  function logout() {
    authToken = "";
    authUser = null;
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    goTo("/");
  }

  async function login() {
    loading = true;
    message = "";
    try {
      const data = await api("/auth/login", "POST", loginForm);
      saveAuth(data.token, data.user);
      const next = query.get("next");
      goTo(next || (data.user.role === "admin" ? "/admin" : "/staff"));
    } catch (e) {
      message = e.message;
    } finally {
      loading = false;
    }
  }

  function extractWaiverTokenFromText(text) {
    const s = String(text).trim();
    const m = s.match(/\/check\/([^/?#]+)/);
    if (m) return m[1];
    if (s && !/\s/.test(s) && s.length >= 12) return s;
    return "";
  }

  function stopStaffScan() {
    staffScanRunning = false;
    if (staffScanRaf) cancelAnimationFrame(staffScanRaf);
    staffScanRaf = 0;
    if (staffScanStream) {
      staffScanStream.getTracks().forEach((t) => t.stop());
      staffScanStream = null;
    }
    if (staffScanVideoEl) staffScanVideoEl.srcObject = null;
    staffScanDetector = null;
  }

  onDestroy(stopStaffScan);

  $: if (!(path === "/staff" && authToken)) stopStaffScan();

  async function staffConsumeQrFromRaw(raw) {
    if (staffScanBusy) return;
    const token = extractWaiverTokenFromText(raw);
    if (!token) {
      staffScanError = "No se reconoció un código del parque.";
      return;
    }
    staffScanBusy = true;
    staffScanError = "";
    try {
      staffScanResult = await api(`/reports/validate/${encodeURIComponent(token)}`);
      await loadReport();
    } catch (e) {
      staffScanResult = null;
      staffScanError = e.message;
    } finally {
      staffScanBusy = false;
    }
  }

  async function startStaffScan() {
    staffScanError = "";
    stopStaffScan();
    staffScanResult = null;
    staffScanRunning = true;
    try {
      staffScanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
      staffScanVideoEl.srcObject = staffScanStream;
      await staffScanVideoEl.play();

      if ("BarcodeDetector" in window) {
        staffScanDetector = new BarcodeDetector({ formats: ["qr_code"] });
        let lastDetect = 0;
        let barcodeDetectBusy = false;
        const tick = async () => {
          if (!staffScanRunning) return;
          staffScanRaf = requestAnimationFrame(tick);
          const now = performance.now();
          if (barcodeDetectBusy || staffScanBusy) return;
          if (now - lastDetect < 380) return;
          barcodeDetectBusy = true;
          try {
            const codes = await staffScanDetector.detect(staffScanVideoEl);
            lastDetect = performance.now();
            if (codes.length && codes[0].rawValue) {
              stopStaffScan();
              await staffConsumeQrFromRaw(codes[0].rawValue);
            }
          } catch {
            /* frame */
          } finally {
            barcodeDetectBusy = false;
          }
        };
        tick();
        return;
      }

      const jsQR = (await import("jsqr")).default;
      const decodeCanvas = document.createElement("canvas");
      const decodeCtx = decodeCanvas.getContext("2d", { willReadFrequently: true });
      let lastDecode = 0;
      let jsqrDecodeBusy = false;
      const tickJs = async () => {
        if (!staffScanRunning) return;
        staffScanRaf = requestAnimationFrame(tickJs);
        const now = performance.now();
        if (jsqrDecodeBusy || staffScanBusy) return;
        if (now - lastDecode < 280) return;
        const vw = staffScanVideoEl.videoWidth;
        const vh = staffScanVideoEl.videoHeight;
        if (vw < 16 || vh < 16) {
          lastDecode = performance.now();
          return;
        }
        jsqrDecodeBusy = true;
        try {
          const maxW = 720;
          const sc = Math.min(1, maxW / vw);
          const dw = Math.floor(vw * sc);
          const dh = Math.floor(vh * sc);
          decodeCanvas.width = dw;
          decodeCanvas.height = dh;
          decodeCtx.drawImage(staffScanVideoEl, 0, 0, dw, dh);
          const img = decodeCtx.getImageData(0, 0, dw, dh);
          const hit = jsQR(img.data, dw, dh, { inversionAttempts: "attemptBoth" });
          lastDecode = performance.now();
          if (hit?.data) {
            stopStaffScan();
            await staffConsumeQrFromRaw(hit.data);
          }
        } catch {
          lastDecode = performance.now();
        } finally {
          jsqrDecodeBusy = false;
        }
      };
      tickJs();
    } catch (e) {
      staffScanError = e.message || "No se pudo abrir la cámara.";
      stopStaffScan();
    }
  }

  async function loadCheck() {
    const token = path.split("/check/")[1]?.split("?")[0];
    if (!token) return;
    checkData = null;
    loading = true;
    message = "";
    try {
      const r = await fetch(`${API_BASE}/public/check/${encodeURIComponent(token)}`);
      const data = await r.json();
      if (typeof data.valid === "boolean") {
        checkData = data;
        message = data.error || "";
      } else {
        checkData = null;
        message = "No se pudo cargar el código.";
      }
    } catch {
      checkData = null;
      message = "No se pudo cargar.";
    } finally {
      loading = false;
    }
  }

  async function loadReport() {
    report = await api("/reports/waivers");
  }

  function adminReportQueryString(includePagination) {
    const p = new URLSearchParams();
    if (adminReportFilters.attractionId) p.set("attractionId", adminReportFilters.attractionId);
    if (adminReportFilters.from) p.set("from", adminReportFilters.from);
    if (adminReportFilters.to) p.set("to", adminReportFilters.to);
    if (adminReportFilters.status) p.set("status", adminReportFilters.status);
    const qv = adminReportFilters.q.trim();
    if (qv) p.set("q", qv);
    if (includePagination) {
      p.set("page", String(adminReport.page));
      p.set("pageSize", String(Number(adminReport.pageSize) || 25));
    }
    return p.toString();
  }

  async function loadAdminReport() {
    loading = true;
    message = "";
    try {
      const qs = adminReportQueryString(true);
      const data = await api(`/admin/reports/waivers?${qs}`);
      adminReport = {
        items: data.items || [],
        total: data.total ?? 0,
        page: data.page ?? 1,
        pageSize: data.pageSize ?? 25,
        summary: data.summary ?? null
      };
    } catch (e) {
      message = e.message;
    } finally {
      loading = false;
    }
  }

  function applyAdminReportFilters() {
    adminReport = { ...adminReport, page: 1 };
    loadAdminReport();
  }

  function adminReportPrevPage() {
    if (adminReport.page <= 1) return;
    adminReport = { ...adminReport, page: adminReport.page - 1 };
    loadAdminReport();
  }

  function adminReportNextPage() {
    const pages = Math.max(1, Math.ceil(adminReport.total / adminReport.pageSize));
    if (adminReport.page >= pages) return;
    adminReport = { ...adminReport, page: adminReport.page + 1 };
    loadAdminReport();
  }

  async function downloadAdminReportCsv() {
    message = "";
    try {
      const qs = adminReportQueryString(false);
      const r = await fetch(`${API_BASE}/admin/reports/waivers/export.csv?${qs}`, {
        headers: { ...authHeaders() }
      });
      if (!r.ok) {
        let err = "Error al descargar CSV.";
        try {
          const j = await r.json();
          if (j.error) err = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(err);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waivers-reporte-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message = e.message;
    }
  }

  async function loadAdminData() {
    adminAttractions = await api("/admin/attractions");
    adminUsers = await api("/admin/users");
    await loadReport();
  }

  async function createAttraction() {
    message = "";
    if (!newAttraction.name?.trim() || !newAttraction.code?.trim()) {
      message = "Nombre y código son obligatorios.";
      return;
    }
    if (isWaiverTextEmpty(newAttraction.waiverText)) {
      message = "El texto del waiver es obligatorio.";
      return;
    }
    try {
      await api("/admin/attractions", "POST", newAttraction);
      newAttraction = { name: "", code: "", description: "", waiverText: "", active: true, stripeEnabled: false };
      waiverEditorKey += 1;
      await loadAdminData();
      message = "Atracción creada.";
    } catch (e) {
      message = e.message;
    }
  }

  async function toggleAttraction(item) {
    await api(`/admin/attractions/${item._id}`, "PATCH", { active: !item.active });
    await loadAdminData();
  }

  function startEditAttraction(item) {
    adminAttractionEditId = item._id;
    editWaiverText = item.waiverText || "";
    editAttractionDescription = item.description || "";
    editStripeEnabled = item.stripeEnabled === true;
  }

  function cancelEditAttraction() {
    adminAttractionEditId = "";
    editWaiverText = "";
    editAttractionDescription = "";
    editStripeEnabled = false;
  }

  async function saveAttractionText(item) {
    message = "";
    if (isWaiverTextEmpty(editWaiverText)) {
      message = "El texto del waiver es obligatorio.";
      return;
    }
    try {
      await api(`/admin/attractions/${item._id}`, "PATCH", {
        waiverText: editWaiverText,
        description: editAttractionDescription,
        stripeEnabled: editStripeEnabled
      });
      await loadAdminData();
      cancelEditAttraction();
      message = "Texto de la carta actualizado.";
    } catch (e) {
      message = e.message;
    }
  }

  async function createUser() {
    message = "";
    try {
      await api("/admin/users", "POST", newUser);
      newUser = { name: "", email: "", password: "", role: "staff" };
      await loadAdminData();
      message = "Usuario creado.";
    } catch (e) {
      message = e.message;
    }
  }

  async function toggleUser(user) {
    await api(`/admin/users/${user._id || user.id}`, "PATCH", { active: !user.active });
    await loadAdminData();
  }

  async function bootstrap() {
    message = "";
    document.documentElement.lang = locale === "en" ? "en" : "es";
    showAdminLogin = path === "/admin" && (!authToken || authUser?.role !== "admin");
    if (path.startsWith("/check/")) return loadCheck();
    if (path === "/staff") {
      if (!authToken) return goTo("/admin?next=/staff");
      return loadReport();
    }
    if (path === "/admin") {
      if (!authToken || authUser?.role !== "admin") return;
      return loadAdminData();
    }
    if (path === "/success") {
      await loadPublicAttractions();
      await finalizeSuccessfulPayment();
      return;
    }
    if (path === "/cancel") {
      await loadPublicAttractions();
      await handleCancelledPayment();
      return;
    }
    await loadPublicAttractions();
  }

  bootstrap();
</script>

<main>
  <header>
    <div class="brand">
      <img src={logoBarrancas} alt="Parque Barrancas" class="brand-logo" />
      <h1>{isPublicWaiverUi ? L.siteTitle : "Waiver Digital - Parque Temático"}</h1>
    </div>
    <nav>
      {#if path === "/admin"}
        <span class="admin-pill">Modo Admin</span>
      {:else}
        <button on:click={() => goTo("/admin")}>{isPublicWaiverUi ? L.admin : "Admin"}</button>
      {/if}
      {#if authToken}
        <button on:click={logout}>{isPublicWaiverUi ? L.logout : "Salir"}</button>
      {/if}
    </nav>
  </header>

  {#if isPublicWaiverUi}
    <div class="lang-switch" role="group" aria-label="Language">
      <button
        type="button"
        class="lang-btn"
        class:lang-active={locale === "es"}
        on:click={() => setLocale("es")}
      >
        {L.langEs}
      </button>
      <button
        type="button"
        class="lang-btn"
        class:lang-active={locale === "en"}
        on:click={() => setLocale("en")}
      >
        {L.langEn}
      </button>
    </div>
  {/if}

  {#if path.startsWith("/check/")}
    <section class="card">
      <h2>Tu código de acceso</h2>
      {#if checkData?.valid}
        <p class="ok">Listo para ingresar</p>
        <p><b>Nombre:</b> {checkData.waiver.fullName}</p>
        <p><b>Atracción:</b> {checkData.waiver.attractionName}</p>
        <p><b>Fecha de firma:</b> {new Date(checkData.waiver.signedAt).toLocaleString()}</p>
        <p><b>Folio:</b> {checkData.waiver.id}</p>
        <p class="muted">
          Muéstralo al personal en la atracción. Abrir este enlace o escanearlo tú mismo aquí no lo marca como usado.
        </p>
      {:else if checkData?.reason === "qr_already_used"}
        <p class="bad">Ya fue usado en atracción</p>
        <p class="muted">
          Este código ya fue validado por el personal. Para otra vuelta hace falta firmar un waiver nuevo.
        </p>
        <p><b>Atracción en la que se validó:</b> {checkData.attractionName}</p>
        <p><b>Validado el:</b> {new Date(checkData.usedAt).toLocaleString("es-MX")}</p>
        {#if checkData.fullName}
          <p><b>Nombre:</b> {checkData.fullName}</p>
        {/if}
      {:else}
        <p class="bad">No disponible</p>
        <p>{message || "No se pudo mostrar el código."}</p>
      {/if}
    </section>
  {:else if path === "/staff"}
    <section class="card">
      <h2>Panel Staff</h2>
      <p>Usuario: {authUser?.name} ({authUser?.role})</p>
      <p class="muted">
        Inicia sesión aquí (sesión hasta 7 días). Valida con la cámara o pegando el enlace; solo entonces el QR queda
        usado. Si el visitante abre el enlace del correo, solo ve su pase, sin gastarlo.
      </p>

      <h3>Validar QR</h3>
      {#if staffScanError}<p class="bad">{staffScanError}</p>{/if}
      <video bind:this={staffScanVideoEl} class="staff-scan-video" playsinline muted></video>
      <div class="inline-actions staff-scan-actions">
        {#if staffScanRunning}
          <button type="button" on:click={stopStaffScan}>Detener cámara</button>
        {:else}
          <button type="button" on:click={startStaffScan} disabled={staffScanBusy}>Escanear con cámara</button>
        {/if}
      </div>
      <label class="field-label" for="staffPaste">Pegar URL o token del QR</label>
      <textarea id="staffPaste" bind:value={staffScanPaste} rows="2" placeholder="https://…/check/…"></textarea>
      <button type="button" on:click={() => staffConsumeQrFromRaw(staffScanPaste)} disabled={staffScanBusy}>
        {staffScanBusy ? "Validando…" : "Validar pegado"}
      </button>
      <button type="button" class="secondary" on:click={() => { staffScanResult = null; staffScanError = ""; }}>
        Limpiar resultado
      </button>

      {#if staffScanResult?.valid}
        <div class="staff-scan-result">
          <p class="ok">VÁLIDO — registrado</p>
          <p><b>Nombre:</b> {staffScanResult.waiver.fullName}</p>
          <p><b>Atracción:</b> {staffScanResult.waiver.attractionName}</p>
          <p><b>Folio:</b> {staffScanResult.waiver.id}</p>
        </div>
      {:else if staffScanResult?.reason === "qr_already_used"}
        <div class="staff-scan-result">
          <p class="bad">Ya estaba usado</p>
          <p><b>Atracción:</b> {staffScanResult.attractionName}</p>
          <p><b>Validado el:</b> {new Date(staffScanResult.usedAt).toLocaleString("es-MX")}</p>
          {#if staffScanResult.fullName}<p><b>Nombre:</b> {staffScanResult.fullName}</p>{/if}
        </div>
      {/if}

      <h3>Últimos registros</h3>
      {#if report.summary}
        <p><b>Total:</b> {report.summary.total} | <b>Firmados:</b> {report.summary.signed} | <b>Revocados:</b> {report.summary.revoked}</p>
      {/if}
      {#each report.waivers as item}
        <div class="item">
          <p>{item.fullName} - {item.attractionName} - {new Date(item.createdAt).toLocaleString()}</p>
        </div>
      {/each}
    </section>
  {:else if path === "/admin"}
    <section class="card">
      {#if showAdminLogin}
        <h2>Acceso Admin</h2>
        {#if message}<p class="bad">{message}</p>{/if}
        <input bind:value={loginForm.email} placeholder="Correo electrónico" />
        <input bind:value={loginForm.password} type="password" placeholder="Contraseña" />
        <button on:click={login} disabled={loading}>{loading ? "Entrando..." : "Iniciar sesión"}</button>
      {:else}
        <h2>Administrador</h2>
        {#if message}<p>{message}</p>{/if}

        <div class="tabs">
          <button class:tab-active={adminTab === "new-attraction"} on:click={() => (adminTab = "new-attraction")}>
            Nueva atracción
          </button>
          <button class:tab-active={adminTab === "attractions"} on:click={() => (adminTab = "attractions")}>
            Atracciones
          </button>
          <button class:tab-active={adminTab === "users"} on:click={() => (adminTab = "users")}>
            Usuarios
          </button>
          <button class:tab-active={adminTab === "report"} on:click={() => (adminTab = "report")}>
            Reporte básico
          </button>
          <button
            class:tab-active={adminTab === "db-report"}
            on:click={() => {
              adminTab = "db-report";
              adminReport = { ...adminReport, page: 1 };
              loadAdminReport();
            }}
          >
            Reporte base de datos
          </button>
        </div>

        {#if adminTab === "new-attraction"}
          <h3>Nueva atracción</h3>
          <input bind:value={newAttraction.name} placeholder="Nombre" />
          <input bind:value={newAttraction.code} placeholder="Código único" />
          <input bind:value={newAttraction.description} placeholder="Descripción corta" />
          <label class="field-label" for="newWaiverText">Carta responsiva</label>
          {#key waiverEditorKey}
            <WaiverTextEditor bind:value={newAttraction.waiverText} />
          {/key}
          <label class="checkbox-label admin-checkbox">
            <input type="checkbox" bind:checked={newAttraction.stripeEnabled} />
            Requiere pago en línea (Stripe) — eventos fuera del parque
          </label>
          <button on:click={createAttraction}>Crear atracción</button>
        {/if}

        {#if adminTab === "attractions"}
          <h3>Atracciones</h3>
          {#each adminAttractions as item}
            <div class="item">
              <p>
                <b>{item.name}</b> ({item.code}) - {item.active ? "Activa" : "Inactiva"}
                {#if item.stripeEnabled}
                  · Pago Stripe
                {:else}
                  · Sin pago en línea
                {/if}
              </p>
              <div class="inline-actions">
                <button on:click={() => startEditAttraction(item)}>Editar texto</button>
                <button on:click={() => toggleAttraction(item)}>
                  {item.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
            {#if adminAttractionEditId === item._id}
              <div class="card edit-card">
                <label class="field-label" for="editDescription">Descripción</label>
                <input id="editDescription" bind:value={editAttractionDescription} />
                <label class="field-label" for="editWaiverText">Carta responsiva</label>
                {#key adminAttractionEditId}
                  <WaiverTextEditor bind:value={editWaiverText} />
                {/key}
                <label class="checkbox-label admin-checkbox">
                  <input type="checkbox" bind:checked={editStripeEnabled} />
                  Requiere pago en línea (Stripe) — eventos fuera del parque
                </label>
                <div class="inline-actions">
                  <button type="button" on:click={() => saveAttractionText(item)}>Guardar cambios</button>
                  <button type="button" on:click={cancelEditAttraction}>Cancelar</button>
                </div>
              </div>
            {/if}
          {/each}
        {/if}

        {#if adminTab === "users"}
          <h3>Crear usuario</h3>
          <input bind:value={newUser.name} placeholder="Nombre" />
          <input bind:value={newUser.email} placeholder="Correo electrónico" />
          <input bind:value={newUser.password} type="password" placeholder="Contraseña" />
          <select bind:value={newUser.role}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
          <button on:click={createUser}>Crear usuario</button>

          <h3>Usuarios</h3>
          {#each adminUsers as user}
            <div class="item">
              <p>{user.name} ({user.email}) - {user.role} - {user.active ? "Activo" : "Inactivo"}</p>
              <button on:click={() => toggleUser(user)}>{user.active ? "Desactivar" : "Activar"}</button>
            </div>
          {/each}
        {/if}

        {#if adminTab === "report"}
          <h3>Reporte básico</h3>
          {#if report.summary}
            <p><b>Total:</b> {report.summary.total} | <b>Firmados:</b> {report.summary.signed} | <b>Revocados:</b> {report.summary.revoked}</p>
          {:else}
            <p>No hay datos de reporte.</p>
          {/if}
        {/if}
        {#if adminTab === "db-report"}
          <h3>Reporte base de datos</h3>
          <p class="muted">
            Filtros aplican a la tabla y al CSV. El archivo incluye hasta 50 mil filas con los mismos filtros (sin imágenes de firma).
          </p>
          <div class="filter-row">
            <label class="field-label" for="repAttr">Atracción</label>
            <select id="repAttr" bind:value={adminReportFilters.attractionId}>
              <option value="">Todas</option>
              {#each adminAttractions as a}
                <option value={a._id}>{a.name}</option>
              {/each}
            </select>
            <label class="field-label" for="repFrom">Desde</label>
            <input id="repFrom" type="date" bind:value={adminReportFilters.from} />
            <label class="field-label" for="repTo">Hasta</label>
            <input id="repTo" type="date" bind:value={adminReportFilters.to} />
            <label class="field-label" for="repSt">Estado</label>
            <select id="repSt" bind:value={adminReportFilters.status}>
              <option value="">Todos</option>
              <option value="signed">Firmado</option>
              <option value="revoked">Revocado</option>
            </select>
            <label class="field-label" for="repQ">Buscar</label>
            <input id="repQ" bind:value={adminReportFilters.q} placeholder="Nombre o correo" />
            <div class="inline-actions filter-actions">
              <button type="button" on:click={applyAdminReportFilters} disabled={loading}>Aplicar</button>
              <button type="button" on:click={downloadAdminReportCsv} disabled={loading}>Descargar CSV</button>
            </div>
          </div>
          {#if adminReport.summary}
            <p>
              <b>Coincidencias:</b> {adminReport.summary.total} |
              <b>Firmados:</b> {adminReport.summary.signed} |
              <b>Revocados:</b> {adminReport.summary.revoked}
            </p>
          {/if}
          <div class="table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Atracción</th>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Teléfono</th>
                  <th>Nacimiento</th>
                  <th>Estado</th>
                  <th>QR validado (staff)</th>
                  <th>Fecha registro</th>
                </tr>
              </thead>
              <tbody>
                {#each adminReport.items as row}
                  <tr>
                    <td>{row.id}</td>
                    <td>{row.attractionName}</td>
                    <td>{row.fullName}</td>
                    <td>{row.email}</td>
                    <td>{row.phone}</td>
                    <td>{row.birthDate}</td>
                    <td>{row.status}</td>
                    <td>{row.qrConsumedAt ? new Date(row.qrConsumedAt).toLocaleString("es-MX") : "—"}</td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if adminReport.items.length === 0 && !loading}
            <p>No hay registros con estos filtros.</p>
          {/if}
          <div class="inline-actions pager">
            <button type="button" disabled={loading || adminReport.page <= 1} on:click={adminReportPrevPage}>
              Anterior
            </button>
            <span class="pager-info">
              Página {adminReport.page} de {Math.max(1, Math.ceil(adminReport.total / adminReport.pageSize))}
              ({adminReport.total} total)
            </span>
            <button
              type="button"
              disabled={loading || adminReport.page >= Math.max(1, Math.ceil(adminReport.total / adminReport.pageSize))}
              on:click={adminReportNextPage}
            >
              Siguiente
            </button>
            <label class="field-label inline-label" for="repPs">Por página</label>
            <select
              id="repPs"
              bind:value={adminReport.pageSize}
              on:change={() => {
                adminReport = { ...adminReport, page: 1 };
                loadAdminReport();
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        {/if}
      {/if}
    </section>
  {:else}
    <section class="card waiver-form">
      <h2>{L.waiverTitle}</h2>
      {#if message}<p class="bad">{message}</p>{/if}
      <div class="form-section">
        <div class="form-section-header form-section-header-with-iso">
          <h3 class="form-section-title form-section-title-inline">{L.sectionParticipant}</h3>
          <img
            src={locale === "en" ? waiverIsoEn : waiverIsoEs}
            alt=""
            class="waiver-iso-code"
            width="142"
            height="64"
          />
        </div>
        <div class="form-section-body">
          <div class="field-group" class:field-invalid={fieldInvalid("attractionId")}>
            <label class="field-label" for="atraccion">{L.attraction}</label>
            <select id="atraccion" bind:value={selectedAttractionId} on:change={() => (selectedAttraction = attractions.find((a) => a._id === selectedAttractionId))}>
              {#each attractions as a}
                <option value={a._id}>{a.name}</option>
              {/each}
            </select>
          </div>
          <div class="field-group" class:field-invalid={fieldInvalid("fullName")}>
            <label class="field-label" for="fullName">{L.fullName}</label>
            <input id="fullName" bind:value={form.fullName} autocomplete="name" />
          </div>
          <div class="form-grid-2">
            <div class="field-group" class:field-invalid={fieldInvalid("birthDate")}>
              <label class="field-label" for="birthDate">{L.birthDate}</label>
              <input id="birthDate" type="date" bind:value={form.birthDate} />
            </div>
            <div class="field-group" class:field-invalid={fieldInvalid("gender")}>
              <p class="field-label">{L.gender}</p>
              <div class="radio-row" role="radiogroup" aria-label={L.gender}>
                <label><input type="radio" bind:group={form.gender} value="masculino" /> {L.male}</label>
                <label><input type="radio" bind:group={form.gender} value="femenino" /> {L.female}</label>
              </div>
            </div>
          </div>
          <div class="form-grid-2">
            <div class="field-group" class:field-invalid={fieldInvalid("phone")}>
              <label class="field-label" for="phone">{L.phone}</label>
              <input id="phone" bind:value={form.phone} type="tel" autocomplete="tel" inputmode="tel" />
            </div>
            <div class="field-group" class:field-invalid={fieldInvalid("email")}>
              <label class="field-label" for="email">{L.email}</label>
              <input id="email" bind:value={form.email} type="email" autocomplete="email" inputmode="email" />
            </div>
          </div>
          <div class="form-grid-2">
            <div class="field-group" class:field-invalid={fieldInvalid("nationality")}>
              <label class="field-label" for="nationality">{L.nationality}</label>
              <select id="nationality" bind:value={selectedNationality}>
                <option value="">{L.selectNationality}</option>
                {#each NATIONALITIES as country}
                  <option value={country}>{locale === "en" ? NATIONALITY_EN[country] || country : country}</option>
                {/each}
              </select>
            </div>
            {#if isMexico}
              <div class="field-group" class:field-invalid={fieldInvalid("state")}>
                <label class="field-label" for="state">{L.state}</label>
                <select id="state" bind:value={selectedState} on:change={onLocationStateChange}>
                  <option value="">{L.selectState}</option>
                  {#each MEXICO_STATES as state}
                    <option value={state}>{state}</option>
                  {/each}
                </select>
              </div>
            {:else}
              <div class="field-group" class:field-invalid={fieldInvalid("foreignCityState")}>
                <label class="field-label" for="foreignCityState">{L.cityState}</label>
                <input id="foreignCityState" bind:value={foreignCityState} autocomplete="address-level2" />
              </div>
            {/if}
          </div>
          {#if isMexico}
            <div class="form-grid-2">
              <div class="field-group" class:field-invalid={fieldInvalid("city")}>
                <label class="field-label" for="city">{L.city}</label>
                <select id="city" bind:value={selectedCity} disabled={!selectedState}>
                  <option value="">{selectedState ? L.selectCity : L.selectStateFirst}</option>
                  {#each availableCities as city}
                    <option value={city}>{city === "Otra" && locale === "en" ? L.otherCity : city}</option>
                  {/each}
                </select>
              </div>
              {#if selectedCity === "Otra"}
                <div class="field-group" class:field-invalid={fieldInvalid("customCity")}>
                  <label class="field-label" for="customCity">{L.specifyCity}</label>
                  <input id="customCity" bind:value={customCity} />
                </div>
              {/if}
            </div>
          {/if}
          <div class="field-group" class:field-invalid={fieldInvalid("takesMedications")}>
            <label class="field-label" for="takesMedications">{L.takesMedications}</label>
            <select id="takesMedications" bind:value={takesMedications}>
              <option value="">{L.selectOption}</option>
              <option value="no">{L.no}</option>
              <option value="yes">{L.yes}</option>
            </select>
          </div>
          {#if takesMedications === "yes"}
            <div class="field-group" class:field-invalid={fieldInvalid("medications")}>
              <label class="field-label" for="medications">{L.medicationDose}</label>
              <input id="medications" bind:value={form.medications} placeholder={L.medicationPlaceholder} />
            </div>
            <div class="form-grid-2">
              <div class="field-group" class:field-invalid={fieldInvalid("treatingPhysician")}>
                <label class="field-label" for="treatingPhysician">{L.treatingPhysician}</label>
                <input id="treatingPhysician" bind:value={form.treatingPhysician} placeholder={L.physicianPlaceholder} />
              </div>
              <div class="field-group" class:field-invalid={fieldInvalid("physicianPhone")}>
                <label class="field-label" for="physicianPhone">{L.physicianPhone}</label>
                <input id="physicianPhone" bind:value={form.physicianPhone} type="tel" inputmode="tel" />
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="form-section">
        <h3 class="form-section-title">{L.sectionReferences}</h3>
        <div class="form-section-body">
          <div class="form-grid-2 family-refs-grid">
            <div class="family-ref-col">
              <div class="field-group" class:field-invalid={fieldInvalid("emergencyContactName")}>
                <label class="field-label" for="emergencyName">{L.ref1Name}</label>
                <input id="emergencyName" bind:value={form.emergencyContactName} autocomplete="name" />
              </div>
              <div class="field-group" class:field-invalid={fieldInvalid("emergencyContactRelationship")}>
                <label class="field-label" for="emergencyRelationship">{L.ref1Relationship}</label>
                <input id="emergencyRelationship" bind:value={form.emergencyContactRelationship} placeholder={L.relationshipPlaceholder1} />
              </div>
              <div class="field-group" class:field-invalid={fieldInvalid("emergencyContactPhone")}>
                <label class="field-label" for="emergencyPhone">{L.ref1Phone}</label>
                <input id="emergencyPhone" bind:value={form.emergencyContactPhone} type="tel" autocomplete="tel" inputmode="tel" />
              </div>
            </div>
            <div class="family-ref-col">
              <div class="field-group" class:field-invalid={fieldInvalid("familyReference2Name")}>
                <label class="field-label" for="familyRef2Name">{L.ref2Name}</label>
                <input id="familyRef2Name" bind:value={form.familyReference2Name} autocomplete="name" />
              </div>
              <div class="field-group" class:field-invalid={fieldInvalid("familyReference2Relationship")}>
                <label class="field-label" for="familyRef2Relationship">{L.ref2Relationship}</label>
                <input id="familyRef2Relationship" bind:value={form.familyReference2Relationship} placeholder={L.relationshipPlaceholder2} />
              </div>
              <div class="field-group" class:field-invalid={fieldInvalid("familyReference2Phone")}>
                <label class="field-label" for="familyRef2Phone">{L.ref2Phone}</label>
                <input id="familyRef2Phone" bind:value={form.familyReference2Phone} type="tel" inputmode="tel" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3 class="form-section-title">{L.sectionDeclarations}</h3>
        <div class="form-section-body">
          {#if isMinor}
            <p class="bad">{L.minorNotice}</p>
            <button type="button" on:click={() => (guardianModalOpen = true)}>
              {hasRequiredGuardianFields() ? L.editGuardian : L.captureGuardian}
            </button>
          {/if}
          <div class="checkbox-group">
            <label class="checkbox-label"><input type="checkbox" bind:checked={form.hasMedicalCondition} /> {L.medicalCondition}</label>
            <label class="checkbox-label"><input type="checkbox" bind:checked={form.consumedAlcoholOrDrugs} /> {L.alcoholToday}</label>
            <label class="checkbox-label" class:field-invalid={fieldInvalid("acceptsSafetyRules")}><input type="checkbox" bind:checked={form.acceptsSafetyRules} /> {L.safetyRules}</label>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3 class="form-section-title">{L.sectionWaiver}</h3>
        <div class="form-section-body">
          <WaiverTextView content={displayWaiverText} />
          <label class="checkbox-label" class:field-invalid={fieldInvalid("acceptedText")}><input type="checkbox" bind:checked={form.acceptedText} /> {L.acceptWaiver}</label>
        </div>
      </div>

      <div class="form-section">
        <h3 class="form-section-title">{L.sectionSignatures}</h3>
        <div class="form-section-body">
          <div class="form-grid-2 signature-grid">
            <div class="field-group signature-block" class:field-invalid={fieldInvalid("signatureImage")}>
              <p class="signature-label"><b>{L.participantSignature}</b> <span class="signature-hint">{L.signatureHint}</span></p>
              <canvas class="signature-pad" bind:this={signatureCanvas} use:signaturePad width="700" height="180"></canvas>
              <button type="button" class="signature-clear" on:click={clearSignature}>{L.clearParticipantSig}</button>
            </div>
            <div class="field-group signature-block" class:field-invalid={fieldInvalid("witnessSignatureImage")}>
              <p class="signature-label"><b>{L.witnessSignature}</b> <span class="signature-hint">{L.signatureHint}</span></p>
              <canvas class="signature-pad" bind:this={witnessSignatureCanvas} use:witnessSignaturePad width="700" height="180"></canvas>
              <button type="button" class="signature-clear" on:click={clearWitnessSignature}>{L.clearWitnessSig}</button>
            </div>
          </div>
        </div>
      </div>
      <button class="submit-waiver" on:click={submitWaiver} disabled={loading}>
        {loading
          ? requiresStripePayment
            ? L.redirectingPayment
            : L.registering
          : requiresStripePayment
            ? L.signAndPay
            : L.signWaiver}
      </button>
    </section>

    {#if guardianModalOpen}
      <section class="modal-backdrop">
        <div class="modal-card">
          <h3>{L.guardianTitle}</h3>
          <label class="field-label" for="guardianName">{L.guardianName}</label>
          <input id="guardianName" bind:value={guardian.fullName} autocomplete="name" />
          <label class="field-label" for="guardianRelation">{L.guardianRelation}</label>
          <input id="guardianRelation" bind:value={guardian.relation} placeholder={L.guardianRelationPlaceholder} />
          <label class="field-label" for="guardianPhone">{L.guardianPhone}</label>
          <input id="guardianPhone" bind:value={guardian.phone} type="tel" autocomplete="tel" />
          <label class="field-label" for="guardianEmail">{L.guardianEmail}</label>
          <input id="guardianEmail" bind:value={guardian.email} type="email" autocomplete="email" />
          <p><b>{L.guardianSig}</b></p>
          <canvas class="signature-pad" bind:this={guardianSignatureCanvas} use:guardianSignaturePad width="700" height="180"></canvas>
          <div class="modal-actions">
            <button type="button" on:click={clearGuardianSignature}>{L.clearGuardianSig}</button>
            <button type="button" on:click={saveGuardianModal}>{L.saveGuardian}</button>
          </div>
        </div>
      </section>
    {/if}

    {#if waiverResult}
      <section class="modal-backdrop">
        <div class="modal-card">
          <h2>{L.waiverSigned}</h2>
          <p><b>{L.folio}:</b> {waiverResult.waiverId}</p>
          <p><b>{L.signedAt}:</b> {new Date(waiverResult.signedAt).toLocaleString(locale === "en" ? "en-US" : "es-MX")}</p>
          <p><b>{L.qrTitle}</b></p>
          <canvas bind:this={qrCanvas}></canvas>
          <p class="modal-help">
            {L.qrHelp}
          </p>
          {#if waiverResult.emailSent}
            <p class="ok">{L.emailSent}</p>
          {/if}
          <button type="button" on:click={resetRegistrationFlow}>{L.accept}</button>
        </div>
      </section>
    {/if}
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(180deg, #f5f1e8 0%, #f2eee5 100%);
    color: #233528;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    background: #1f4a3b;
    border-radius: 10px;
    padding: 12px;
    color: #f8f3e9;
    box-shadow: 0 8px 20px rgba(22, 43, 34, 0.15);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .brand-logo {
    width: 42px;
    height: 42px;
    object-fit: contain;
    flex: 0 0 auto;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    padding: 3px;
  }
  h1 { font-size: 20px; margin: 0; }
  .lang-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
  }
  .lang-btn {
    padding: 18px 12px;
    font-size: 18px;
    font-weight: 700;
    border-radius: 10px;
    border: 2px solid #1f4a3b;
    background: #fffaf3;
    color: #1f4a3b;
    cursor: pointer;
    text-align: center;
    box-shadow: 0 4px 12px rgba(31, 74, 59, 0.08);
  }
  .lang-btn.lang-active {
    background: #1f4a3b;
    color: #f8f3e9;
    border-color: #1f4a3b;
  }
  nav {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .card {
    background: #fffaf3;
    border-radius: 10px;
    padding: 16px;
    margin-top: 16px;
    display: grid;
    gap: 10px;
    border: 1px solid #e3d7c4;
    box-shadow: 0 8px 18px rgba(31, 74, 59, 0.08);
  }
  input, select, textarea, button {
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #d5c5ad;
    font-size: 14px;
  }
  input, select, textarea {
    background: #fff;
  }
  .field-label {
    font-weight: 600;
    color: #1f4a3b;
    margin-top: 4px;
  }
  .waiver-form {
    gap: 16px;
  }
  .waiver-form .form-section {
    border: 1px solid #e3d7c4;
    border-radius: 10px;
    background: #fff;
    padding: 14px;
    display: grid;
    gap: 12px;
  }
  .waiver-form .form-section-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #1f4a3b;
    padding-bottom: 10px;
    border-bottom: 1px solid #ebdfcc;
    line-height: 1.3;
  }
  .waiver-form .form-section-header-with-iso {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #ebdfcc;
  }
  .waiver-form .form-section-title-inline {
    padding-bottom: 0;
    border-bottom: none;
    flex: 1;
    min-width: 0;
  }
  .waiver-form .waiver-iso-code {
    width: 142px;
    height: 64px;
    object-fit: contain;
    object-position: right center;
    flex-shrink: 0;
  }
  .waiver-form .form-section-body {
    display: grid;
    gap: 12px;
  }
  .waiver-form .field-group {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
  }
  .waiver-form .field-group .field-label {
    margin-top: 0;
    line-height: 1.3;
  }
  .waiver-form .field-group.field-invalid .field-label,
  .waiver-form .checkbox-label.field-invalid {
    color: #b42318;
  }
  .waiver-form .field-group.field-invalid input,
  .waiver-form .field-group.field-invalid select,
  .waiver-form .field-group.field-invalid .signature-pad {
    border-color: #b42318;
    box-shadow: 0 0 0 1px rgba(180, 35, 24, 0.15);
  }
  .form-grid-2 {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .family-ref-col {
    display: grid;
    gap: 12px;
    align-content: start;
    min-width: 0;
  }
  .waiver-form .checkbox-group {
    display: grid;
    gap: 10px;
  }
  .waiver-form .checkbox-label {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    line-height: 1.35;
    font-weight: 500;
    color: #1f4a3b;
    cursor: pointer;
  }
  .waiver-form input[type="checkbox"],
  .waiver-form input[type="radio"] {
    width: 20px;
    height: 20px;
    min-height: 0;
    padding: 0;
    margin: 0;
    flex: 0 0 20px;
    accent-color: #1f4a3b;
    cursor: pointer;
  }
  .waiver-form .radio-row {
    align-items: center;
  }
  .waiver-form .radio-row label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    cursor: pointer;
  }
  .signature-label {
    margin: 0;
    color: #1f4a3b;
    line-height: 1.35;
  }
  .signature-hint {
    font-weight: 400;
    font-size: 13px;
    color: #4a5c52;
  }
  .signature-block .signature-pad {
    max-width: none;
  }
  .signature-clear {
    width: fit-content;
  }
  .submit-waiver {
    margin-top: 4px;
  }
  .admin-checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    color: #1f4a3b;
    cursor: pointer;
  }
  .admin-checkbox input[type="checkbox"] {
    width: 18px;
    height: 18px;
    min-height: 0;
    margin: 0;
    flex: 0 0 18px;
    accent-color: #1f4a3b;
    cursor: pointer;
  }
  .waiver-form input:not([type="checkbox"]):not([type="radio"]),
  .waiver-form select {
    font-size: 16px;
    min-height: 44px;
  }
  @media (min-width: 600px) {
    .form-grid-2 {
      grid-template-columns: 1fr 1fr;
    }
  }
  button {
    cursor: pointer;
    background: #1f4a3b;
    color: white;
    border: 0;
    font-weight: 600;
    transition: background-color 120ms ease;
  }
  button:hover {
    background: #285c49;
  }
  nav button {
    background: #c08a3b;
    color: #13291f;
  }
  nav button:hover {
    background: #d29a45;
  }
  .signature-pad {
    width: 100%;
    max-width: 700px;
    height: 180px;
    border: 1px dashed #c9b292;
    border-radius: 8px;
    background: #fff;
    touch-action: none;
  }
  .item {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    border-bottom: 1px solid #ebdfcc;
    padding: 8px 0;
  }
  .inline-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .radio-row {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    align-items: center;
  }
  .radio-row label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  button.secondary {
    background: #eee8dc;
    color: #1f4a3b;
    border: 1px solid #d5c5ad;
  }
  button.secondary:hover {
    background: #e4dcc8;
  }
  .staff-scan-video {
    width: 100%;
    max-width: 420px;
    border-radius: 8px;
    background: #1a1a1a;
    min-height: 200px;
  }
  .staff-scan-actions {
    margin-top: 4px;
  }
  .staff-scan-result {
    margin-top: 10px;
    padding: 12px;
    background: #fff;
    border: 1px solid #e3d7c4;
    border-radius: 8px;
    display: grid;
    gap: 8px;
  }
  .edit-card {
    margin-top: 6px;
  }
  .muted {
    margin: 0;
    color: #4a5c52;
    font-size: 13px;
  }
  .filter-row {
    display: grid;
    gap: 8px;
    align-items: end;
  }
  .filter-actions {
    margin-top: 4px;
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid #e3d7c4;
    border-radius: 8px;
    background: #fff;
  }
  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    min-width: 920px;
  }
  .report-table th,
  .report-table td {
    border-bottom: 1px solid #ebdfcc;
    padding: 8px;
    text-align: left;
    vertical-align: top;
  }
  .report-table th {
    background: #f0e6d4;
    color: #1f4a3b;
    font-weight: 700;
  }
  .pager {
    align-items: center;
    margin-top: 8px;
  }
  .pager-info {
    font-size: 13px;
    color: #2a4034;
  }
  .inline-label {
    margin: 0;
  }
  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tabs button {
    background: #e6d3b5;
    color: #233528;
  }
  .tabs button.tab-active {
    background: #1f4a3b;
    color: #fff;
  }
  .admin-pill {
    display: inline-flex;
    align-items: center;
    padding: 10px 14px;
    border-radius: 8px;
    background: #d8c6a8;
    color: #13291f;
    font-weight: 700;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(18, 30, 23, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 40;
    padding: 16px;
  }
  .modal-card {
    width: min(760px, 100%);
    background: #fffaf3;
    border-radius: 10px;
    border: 1px solid #e3d7c4;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: 16px;
    display: grid;
    gap: 10px;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .modal-help {
    margin: 0;
    color: #2a4034;
  }
  .ok { color: #1a7f45; font-weight: 700; }
  .bad { color: #b42318; font-weight: 700; }
</style>
