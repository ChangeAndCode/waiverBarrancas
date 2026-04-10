<script>
  import QRCode from "qrcode";

  const API_BASE = "/api";
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

  let authToken = localStorage.getItem("authToken") || "";
  let authUser = JSON.parse(localStorage.getItem("authUser") || "null");

  let attractions = [];
  let selectedAttractionId = "";
  let selectedAttraction = null;
  let waiverResult = null;
  let checkData = null;

  let loginForm = { email: "", password: "" };
  let adminAttractions = [];
  let adminUsers = [];
  let report = { summary: null, byAttraction: [], waivers: [] };
  let adminAttractionEditId = "";
  let editWaiverText = "";
  let editAttractionDescription = "";
  let newUser = { name: "", email: "", password: "", role: "staff" };
  let newAttraction = { name: "", code: "", description: "", waiverText: "", active: true };
  let showAdminLogin = false;
  let adminTab = "new-attraction";

  let form = {
    fullName: "",
    birthDate: "",
    phone: "",
    email: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
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

  function signaturePad(node) {
    const ctx = node.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f4a3b";

    let drawing = false;

    function pointFromEvent(event) {
      const rect = node.getBoundingClientRect();
      const source = event.touches?.[0] || event;
      return { x: source.clientX - rect.left, y: source.clientY - rect.top };
    }

    function start(event) {
      event.preventDefault();
      drawing = true;
      const p = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pointFromEvent(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      signatureHasStroke = true;
    }

    function end() {
      drawing = false;
    }

    node.addEventListener("mousedown", start);
    node.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);

    return {
      destroy() {
        node.removeEventListener("mousedown", start);
        node.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", end);
        node.removeEventListener("touchstart", start);
        node.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
      }
    };
  }

  function guardianSignaturePad(node) {
    const ctx = node.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f4a3b";

    let drawing = false;

    function pointFromEvent(event) {
      const rect = node.getBoundingClientRect();
      const source = event.touches?.[0] || event;
      return { x: source.clientX - rect.left, y: source.clientY - rect.top };
    }

    function start(event) {
      event.preventDefault();
      drawing = true;
      const p = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pointFromEvent(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      guardianSignatureHasStroke = true;
    }

    function end() {
      drawing = false;
    }

    node.addEventListener("mousedown", start);
    node.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);

    return {
      destroy() {
        node.removeEventListener("mousedown", start);
        node.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", end);
        node.removeEventListener("touchstart", start);
        node.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
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
    if (!guardianSignatureCanvas) return;
    const ctx = guardianSignatureCanvas.getContext("2d");
    ctx.clearRect(0, 0, guardianSignatureCanvas.width, guardianSignatureCanvas.height);
    guardianSignatureHasStroke = false;
  }

  function resetRegistrationFlow() {
    waiverResult = null;
    message = "";
    form = {
      fullName: "",
      birthDate: "",
      phone: "",
      email: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
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
    guardianModalOpen = false;
    clearSignature();
    clearGuardianSignature();
    window.location.reload();
  }

  function hasRequiredParticipantFields() {
    return (
      !!selectedAttractionId &&
      !!form.fullName.trim() &&
      !!form.birthDate &&
      !!form.phone.trim() &&
      !!form.email.trim() &&
      !!form.emergencyContactName.trim() &&
      !!form.emergencyContactPhone.trim() &&
      form.acceptedText === true &&
      form.acceptsSafetyRules === true
    );
  }

  function hasRequiredGuardianFields() {
    return (
      !!guardian.fullName.trim() &&
      !!guardian.relation.trim() &&
      !!guardian.phone.trim() &&
      !!guardian.email.trim() &&
      guardianSignatureHasStroke
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
    if (!r.ok) throw new Error((await r.json()).error || "Error");
    return r.json();
  }

  async function loadPublicAttractions() {
    attractions = await api("/public/attractions");
    if (!selectedAttractionId && attractions.length) selectedAttractionId = attractions[0]._id;
    selectedAttraction = attractions.find((a) => a._id === selectedAttractionId) || null;
  }

  async function submitWaiver() {
    loading = true;
    message = "";
    if (!hasRequiredParticipantFields()) {
      loading = false;
      message = "Todos los campos son obligatorios y debes aceptar reglas y carta responsiva.";
      return;
    }
    if (!signatureHasStroke || !signatureCanvas) {
      loading = false;
      message = "La firma manuscrita es obligatoria.";
      return;
    }
    if (isMinor && !hasRequiredGuardianFields()) {
      loading = false;
      guardianModalOpen = true;
      message = "El participante es menor de edad. Captura datos y firma del tutor.";
      return;
    }
    try {
      const signatureImage = signatureCanvas.toDataURL("image/png");
      const guardianSignatureImage = guardianSignatureCanvas?.toDataURL("image/png");
      waiverResult = await api("/public/waivers", "POST", {
        attractionId: selectedAttractionId,
        participant: {
          fullName: form.fullName,
          birthDate: form.birthDate,
          phone: form.phone,
          email: form.email,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: form.emergencyContactPhone
        },
        answers: {
          hasMedicalCondition: form.hasMedicalCondition,
          consumedAlcoholOrDrugs: form.consumedAlcoholOrDrugs,
          acceptsSafetyRules: form.acceptsSafetyRules
        },
        acceptedText: form.acceptedText,
        signatureName: form.fullName,
        signatureImage,
        guardian: isMinor
          ? {
              fullName: guardian.fullName,
              relation: guardian.relation,
              phone: guardian.phone,
              email: guardian.email,
              signatureImage: guardianSignatureImage
            }
          : undefined
      });
      setTimeout(() => {
        if (qrCanvas && waiverResult?.qrUrl) QRCode.toCanvas(qrCanvas, waiverResult.qrUrl);
      }, 0);
    } catch (e) {
      message = e.message;
    } finally {
      loading = false;
    }
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

  async function loadCheck() {
    if (!authToken) return goTo(`/admin?next=${encodeURIComponent(path)}`);
    const token = path.split("/check/")[1];
    if (!token) return;
    try {
      checkData = await api(`/reports/validate/${token}`);
      message = "";
    } catch (e) {
      checkData = null;
      message = e.message;
    }
  }

  async function loadReport() {
    report = await api("/reports/waivers");
  }

  async function loadAdminData() {
    adminAttractions = await api("/admin/attractions");
    adminUsers = await api("/admin/users");
    await loadReport();
  }

  async function createAttraction() {
    message = "";
    try {
      await api("/admin/attractions", "POST", newAttraction);
      newAttraction = { name: "", code: "", description: "", waiverText: "", active: true };
      await loadAdminData();
      message = "Atraccion creada.";
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
  }

  function cancelEditAttraction() {
    adminAttractionEditId = "";
    editWaiverText = "";
    editAttractionDescription = "";
  }

  async function saveAttractionText(item) {
    message = "";
    try {
      await api(`/admin/attractions/${item._id}`, "PATCH", {
        waiverText: editWaiverText,
        description: editAttractionDescription
      });
      await loadAdminData();
      cancelEditAttraction();
      message = "Texto de carta actualizado.";
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
    await loadPublicAttractions();
  }

  bootstrap();
</script>

<main>
  <header>
    <h1>Waiver Digital - Parque Tematico</h1>
    <nav>
      {#if path === "/admin"}
        <span class="admin-pill">Modo Admin</span>
      {:else}
        <button on:click={() => goTo("/admin")}>Admin</button>
      {/if}
      {#if authToken}
        <button on:click={logout}>Salir</button>
      {/if}
    </nav>
  </header>

  {#if path.startsWith("/check/")}
    <section class="card">
      <h2>Validacion de QR (staff)</h2>
      {#if checkData?.valid}
        <p class="ok">VALIDO</p>
        <p><b>Nombre:</b> {checkData.waiver.fullName}</p>
        <p><b>Atraccion:</b> {checkData.waiver.attractionName}</p>
        <p><b>Fecha firma:</b> {new Date(checkData.waiver.signedAt).toLocaleString()}</p>
        <p><b>Folio:</b> {checkData.waiver.id}</p>
      {:else}
        <p class="bad">INVALIDO</p>
        <p>{message || "No se pudo validar."}</p>
      {/if}
    </section>
  {:else if path === "/staff"}
    <section class="card">
      <h2>Panel Staff</h2>
      <p>Usuario: {authUser?.name} ({authUser?.role})</p>
      <p>Escanea QR y abre la URL para validar. Esta vista muestra reportes basicos.</p>
      {#if report.summary}
        <p><b>Total:</b> {report.summary.total} | <b>Firmados:</b> {report.summary.signed} | <b>Revocados:</b> {report.summary.revoked}</p>
      {/if}
      <h3>Ultimos registros</h3>
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
        <input bind:value={loginForm.email} placeholder="Email" />
        <input bind:value={loginForm.password} type="password" placeholder="Password" />
        <button on:click={login} disabled={loading}>{loading ? "Entrando..." : "Iniciar sesion"}</button>
      {:else}
        <h2>Administrador</h2>
        {#if message}<p>{message}</p>{/if}

        <div class="tabs">
          <button class:tab-active={adminTab === "new-attraction"} on:click={() => (adminTab = "new-attraction")}>
            Nueva atraccion
          </button>
          <button class:tab-active={adminTab === "attractions"} on:click={() => (adminTab = "attractions")}>
            Atracciones
          </button>
          <button class:tab-active={adminTab === "users"} on:click={() => (adminTab = "users")}>
            Usuarios
          </button>
          <button class:tab-active={adminTab === "report"} on:click={() => (adminTab = "report")}>
            Reporte basico
          </button>
          <button class:tab-active={adminTab === "db-report"} on:click={() => (adminTab = "db-report")}>
            Reporte base de datos
          </button>
        </div>

        {#if adminTab === "new-attraction"}
          <h3>Nueva atraccion</h3>
          <input bind:value={newAttraction.name} placeholder="Nombre" />
          <input bind:value={newAttraction.code} placeholder="Codigo unico" />
          <input bind:value={newAttraction.description} placeholder="Descripcion corta" />
          <textarea bind:value={newAttraction.waiverText} rows="8" placeholder="Texto del waiver (opcional)"></textarea>
          <button on:click={createAttraction}>Crear atraccion</button>
        {/if}

        {#if adminTab === "attractions"}
          <h3>Atracciones</h3>
          {#each adminAttractions as item}
            <div class="item">
              <p><b>{item.name}</b> ({item.code}) - {item.active ? "Activa" : "Inactiva"}</p>
              <div class="inline-actions">
                <button on:click={() => startEditAttraction(item)}>Editar texto</button>
                <button on:click={() => toggleAttraction(item)}>
                  {item.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
            {#if adminAttractionEditId === item._id}
              <div class="card edit-card">
                <label class="field-label" for="editDescription">Descripcion</label>
                <input id="editDescription" bind:value={editAttractionDescription} />
                <label class="field-label" for="editWaiverText">Carta responsiva</label>
                <textarea id="editWaiverText" bind:value={editWaiverText} rows="10"></textarea>
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
          <input bind:value={newUser.email} placeholder="Email" />
          <input bind:value={newUser.password} type="password" placeholder="Password" />
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
          <h3>Reporte basico</h3>
          {#if report.summary}
            <p><b>Total:</b> {report.summary.total} | <b>Firmados:</b> {report.summary.signed} | <b>Revocados:</b> {report.summary.revoked}</p>
          {:else}
            <p>No hay datos de reporte.</p>
          {/if}
        {/if}
        {#if adminTab === "db-report"}
          <h3>Reporte base de datos</h3>
          {#if report.waivers.length === 0}
            <p>No hay registros.</p>
          {:else}
            {#each report.waivers as item}
              <div class="item">
                <p>{item.fullName} - {item.email} - {item.attractionName}</p>
                <p>{new Date(item.createdAt).toLocaleString()} - {item.status}</p>
              </div>
            {/each}
          {/if}
        {/if}
      {/if}
    </section>
  {:else}
    <section class="card">
      <h2>Registro de Waiver</h2>
      {#if message}<p class="bad">{message}</p>{/if}
      <label class="field-label" for="atraccion">Atracción</label>
      <select id="atraccion" bind:value={selectedAttractionId} on:change={() => (selectedAttraction = attractions.find((a) => a._id === selectedAttractionId))}>
        {#each attractions as a}
          <option value={a._id}>{a.name}</option>
        {/each}
      </select>
      <label class="field-label" for="fullName">Nombre completo (como en tu INE)</label>
      <input id="fullName" bind:value={form.fullName} autocomplete="name" />
      <label class="field-label" for="birthDate">Fecha de nacimiento</label>
      <input id="birthDate" type="date" bind:value={form.birthDate} />
      <label class="field-label" for="phone">Teléfono</label>
      <input id="phone" bind:value={form.phone} type="tel" autocomplete="tel" inputmode="tel" />
      <label class="field-label" for="email">Correo electrónico</label>
      <input id="email" bind:value={form.email} type="email" autocomplete="email" inputmode="email" />
      <label class="field-label" for="emergencyName">Nombre del contacto de emergencia</label>
      <input id="emergencyName" bind:value={form.emergencyContactName} autocomplete="name" />
      <label class="field-label" for="emergencyPhone">Teléfono del contacto de emergencia</label>
      <input id="emergencyPhone" bind:value={form.emergencyContactPhone} type="tel" autocomplete="tel" inputmode="tel" />
      {#if isMinor}
        <p class="bad">Participante menor de edad: se requiere tutor y firma manuscrita del tutor.</p>
        <button type="button" on:click={() => (guardianModalOpen = true)}>
          {hasRequiredGuardianFields() ? "Editar datos de tutor" : "Capturar datos de tutor"}
        </button>
      {/if}

      <label><input type="checkbox" bind:checked={form.hasMedicalCondition} /> Tengo condicion medica relevante</label>
      <label><input type="checkbox" bind:checked={form.consumedAlcoholOrDrugs} /> Consumi alcohol o drogas hoy</label>
      <label><input type="checkbox" bind:checked={form.acceptsSafetyRules} /> Acepto reglas de seguridad</label>

      <h3>Carta responsiva</h3>
      <p class="waiver">{selectedAttraction?.waiverText || ""}</p>
      <label><input type="checkbox" bind:checked={form.acceptedText} /> Lei y acepto la carta responsiva</label>
      <p><b>Firma manuscrita</b> (usa mouse, dedo o stylus)</p>
      <canvas class="signature-pad" bind:this={signatureCanvas} use:signaturePad width="700" height="180"></canvas>
      <button type="button" on:click={clearSignature}>Limpiar firma</button>
      <button on:click={submitWaiver} disabled={loading}>{loading ? "Guardando..." : "Firmar y generar QR"}</button>
    </section>

    {#if guardianModalOpen}
      <section class="modal-backdrop">
        <div class="modal-card">
          <h3>Datos de tutor o padre/madre</h3>
          <label class="field-label" for="guardianName">Nombre completo del tutor</label>
          <input id="guardianName" bind:value={guardian.fullName} autocomplete="name" />
          <label class="field-label" for="guardianRelation">Parentesco</label>
          <input id="guardianRelation" bind:value={guardian.relation} placeholder="Ej. padre, madre, tutor legal" />
          <label class="field-label" for="guardianPhone">Teléfono del tutor</label>
          <input id="guardianPhone" bind:value={guardian.phone} type="tel" autocomplete="tel" />
          <label class="field-label" for="guardianEmail">Correo electrónico del tutor</label>
          <input id="guardianEmail" bind:value={guardian.email} type="email" autocomplete="email" />
          <p><b>Firma manuscrita del tutor</b></p>
          <canvas class="signature-pad" bind:this={guardianSignatureCanvas} use:guardianSignaturePad width="700" height="180"></canvas>
          <div class="modal-actions">
            <button type="button" on:click={clearGuardianSignature}>Limpiar firma tutor</button>
            <button type="button" on:click={() => (guardianModalOpen = false)}>Guardar datos tutor</button>
          </div>
        </div>
      </section>
    {/if}

    {#if waiverResult}
      <section class="modal-backdrop">
        <div class="modal-card">
          <h2>Waiver firmado</h2>
          <p><b>Folio:</b> {waiverResult.waiverId}</p>
          <p><b>Firmado:</b> {new Date(waiverResult.signedAt).toLocaleString()}</p>
          <p><b>Codigo QR de validacion</b></p>
          <canvas bind:this={qrCanvas}></canvas>
          <p class="modal-help">
            Muestra este QR al staff para validar tu acceso a la atraccion.
          </p>
          {#if waiverResult.emailSent}
            <p class="ok">Tambien enviamos este QR al correo registrado.</p>
          {/if}
          <button type="button" on:click={resetRegistrationFlow}>Aceptar</button>
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
  h1 { font-size: 20px; margin: 0; }
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
  .waiver {
    white-space: pre-wrap;
    background: #fff;
    padding: 10px;
    border: 1px solid #e7dbc8;
    border-radius: 6px;
    line-height: 1.4;
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
  .edit-card {
    margin-top: 6px;
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
