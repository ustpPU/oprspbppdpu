/* OPR PPDPU v15 — aliran pantas, crop gambar dan PDF sepadan pratonton. */

function createImageState() {
  return {
    1: { dataUrl: "", existingRef: "", changed: false, sourceUrl: "", originalSource: "" },
    2: { dataUrl: "", existingRef: "", changed: false, sourceUrl: "", originalSource: "" },
    3: { dataUrl: "", existingRef: "", changed: false, sourceUrl: "", originalSource: "" },
    4: { dataUrl: "", existingRef: "", changed: false, sourceUrl: "", originalSource: "" }
  };
}

state.images = createImageState();

let cropperInstance = null;
let activeImageIndex = null;

function getApiUrl() {
  if (window.OPR_API_URL) return window.OPR_API_URL;
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return `${window.location.origin}/api`;
  return GAS_WEB_APP_URL;
}

let previewFitFrame = 0;
let previewRenderFrame = 0;

function schedulePreviewFit() {
  if (previewFitFrame) return;
  previewFitFrame = requestAnimationFrame(() => {
    previewFitFrame = 0;
    fitPreview();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  schedulePreviewFit();
  window.addEventListener("resize", schedulePreviewFit);
  if (window.ResizeObserver) {
    new ResizeObserver(schedulePreviewFit).observe(document.getElementById("previewShell"));
  }
});

function fitPreview() {
  const shell = document.getElementById("previewShell");
  const area = document.getElementById("printArea");
  const notice = document.getElementById("reportFitNotice");
  if (!shell || !area || area.classList.contains("pdf-capture")) return;
  const shellWidth = shell.clientWidth;
  if (!shellWidth) return;
  const scale = Math.min(1, shellWidth / (area.offsetWidth || 794));
  const noticeHeight = notice && !notice.classList.contains("hidden") ? notice.offsetHeight + 8 : 0;
  const height = `${noticeHeight + area.offsetHeight * scale}px`;
  const transform = `scale(${scale})`;
  if (area.style.transform !== transform) area.style.transform = transform;
  if (shell.style.height !== height) shell.style.height = height;
}

async function loadData(isRefresh = false) {
  const refreshSpinner = document.getElementById("refreshSpinner");
  const selectedOfficer = document.getElementById("namaPegawai")?.value || "";
  if (isRefresh && refreshSpinner) refreshSpinner.classList.add("fa-spin");
  if (!isRefresh) {
    try {
      const cached = JSON.parse(localStorage.getItem("oprInitialDataV15") || "null");
      if (cached && cached.status === "success") applyInitialData(cached, selectedOfficer);
    } catch (cacheError) {
      try { localStorage.removeItem("oprInitialDataV15"); }
      catch (storageError) { console.warn("Cache OPR tidak dapat dibersihkan:", storageError); }
    }
  }
  try {
    const response = await fetch(`${getApiUrl()}?action=getInitialData`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.status !== "success") throw new Error(result.message || "Data tidak dapat dimuatkan");
    applyInitialData(result, document.getElementById("namaPegawai")?.value || "");
    const saveCache = () => {
      try { localStorage.setItem("oprInitialDataV15", JSON.stringify(result)); }
      catch (cacheError) { console.warn("Cache OPR tidak dapat disimpan:", cacheError); }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(saveCache, { timeout: 1500 });
    else setTimeout(saveCache, 0);
  } catch (err) {
    console.error("Gagal tarik data:", err);
    const tbody = document.getElementById("oprTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-red-600">Data gagal dimuatkan. Sila tekan Refresh.</td></tr>`;
  } finally {
    if (isRefresh && refreshSpinner) refreshSpinner.classList.remove("fa-spin");
  }
}

function applyInitialData(result, selectedOfficer = "") {
  state.pegawai = result.pegawai || [];
  state.respon = result.respon || [];
  renderStats();
  filterTable();
  populatePegawaiDropdown();
  if (selectedOfficer && state.pegawai.some(person => person.nama === selectedOfficer)) {
    document.getElementById("namaPegawai").value = selectedOfficer;
  }
  officerGridDirty = true;
  if (!document.getElementById("sec-pegawai")?.classList.contains("hidden")) renderOfficerGridIfNeeded();
}

let officerGridDirty = false;
function renderOfficerGridIfNeeded() {
  if (!officerGridDirty) return;
  renderPegawaiGrid();
  officerGridDirty = false;
}

let searchTimer;
function scheduleReportSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterTable, 120);
}

function renderStats() {
  document.getElementById("statTotalOpr").innerText = state.respon.length;
  document.getElementById("statTotalPegawai").innerText = state.pegawai.length;
  const now = new Date();
  const countMonth = state.respon.filter(r => {
    const stamp = String(r.timestamp || "").replace(" ", "T");
    const date = new Date(stamp);
    return !Number.isNaN(date.getTime()) && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;
  document.getElementById("statMonthOpr").innerText = countMonth;
}

function processAndUploadImage(event, index) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Sila pilih fail gambar yang sah.");
    event.target.value = "";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    alert("Gambar terlalu besar. Had maksimum ialah 15 MB.");
    event.target.value = "";
    return;
  }
  const imageState = state.images[index];
  if (imageState.sourceUrl && imageState.sourceUrl.startsWith("blob:")) URL.revokeObjectURL(imageState.sourceUrl);
  imageState.sourceUrl = URL.createObjectURL(file);
  imageState.originalSource = imageState.sourceUrl;
  openImageEditor(index, imageState.sourceUrl);
}

function openImageEditor(index, sourceOverride = "") {
  const imageState = state.images[index];
  // Sentiasa buka daripada fail asal supaya Reset benar-benar kembali ke gambar asal.
  const source = sourceOverride || imageState.originalSource || imageState.sourceUrl || imageState.dataUrl;
  if (!source) return;
  activeImageIndex = index;
  const modal = document.getElementById("imageEditorModal");
  const image = document.getElementById("cropperImage");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  image.src = source;
  if (cropperInstance) cropperInstance.destroy();
  cropperInstance = new Cropper(image, {
    aspectRatio: index === 1 ? 16 / 9 : 4 / 3,
    viewMode: 1,
    dragMode: "move",
    autoCropArea: 1,
    responsive: true,
    background: false,
    guides: true,
    center: true,
    movable: true,
    zoomable: false,
    zoomOnWheel: false,
    zoomOnTouch: false,
    cropBoxMovable: false,
    cropBoxResizable: false,
    scalable: false,
    rotatable: false,
    toggleDragModeOnDblclick: false
  });
}

function closeImageEditor() {
  const modal = document.getElementById("imageEditorModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  activeImageIndex = null;
}

function cropReset() {
  if (cropperInstance) cropperInstance.reset();
}

function applyImageCrop() {
  if (!cropperInstance || !activeImageIndex) return;
  const index = activeImageIndex;
  const canvas = cropperInstance.getCroppedCanvas({
    width: index === 1 ? 1280 : 900,
    height: index === 1 ? 720 : 675,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    fillColor: "#ffffff"
  });
  const imageState = state.images[index];
  imageState.dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  imageState.changed = true;
  document.getElementById(`editImgBtn${index}`).classList.remove("hidden");
  closeImageEditor();
  updatePreview();
}

function updatePreview() {
  if (previewRenderFrame) return;
  previewRenderFrame = requestAnimationFrame(flushPreview);
}

function flushPreview() {
  if (previewRenderFrame) cancelAnimationFrame(previewRenderFrame);
  previewRenderFrame = 0;
  document.getElementById("prevTajuk").innerText = document.getElementById("tajukProgram").value || "";
  document.getElementById("prevTarikh").innerText = document.getElementById("tarikhPelaksanaan").value || "";
  document.getElementById("prevMasa").innerText = document.getElementById("masa").value || "";
  document.getElementById("prevSasaran").innerText = document.getElementById("sasaran").value || "";
  const pelibatan = document.getElementById("pelibatan").value;
  document.getElementById("prevPelibatan").innerText = pelibatan;
  document.getElementById("prevPelibatanBox").classList.toggle("hidden", !pelibatan);
  document.getElementById("prevObjektif").innerText = document.getElementById("objektif").value || "";
  document.getElementById("prevKekuatan").innerText = document.getElementById("kekuatan").value || "";
  document.getElementById("prevPenambahbaikan").innerText = document.getElementById("penambahbaikan").value || "";
  document.getElementById("prevNama").innerText = document.getElementById("namaPegawai").value || "";
  document.getElementById("prevJawatan").innerText = document.getElementById("jawatanPegawai").value || "";
  document.getElementById("prevTarikhLaporan").innerText = document.getElementById("tarikhLaporan").value || "";

  const hero = document.getElementById("prevImg1");
  const heroData = state.images[1].dataUrl;
  if (hero.getAttribute("src") !== (heroData || null)) {
    if (heroData) hero.src = heroData;
    else hero.removeAttribute("src");
  }
  hero.classList.toggle("hidden", !heroData);

  let hasGallery = false;
  for (let index = 2; index <= 4; index++) {
    const imageData = state.images[index].dataUrl;
    const box = document.getElementById(`boxImg${index}`);
    const image = document.getElementById(`prevImg${index}`);
    const caption = document.getElementById(`prevCap${index}`);
    if (image.getAttribute("src") !== (imageData || null)) {
      if (imageData) image.src = imageData;
      else image.removeAttribute("src");
    }
    box.classList.toggle("hidden", !imageData);
    caption.innerText = document.getElementById(`kapsyen${index}`).value || `Gambar ${index}`;
    if (imageData) hasGallery = true;
  }
  document.getElementById("prevGalleryBox").classList.toggle("hidden", !hasGallery);
  fitReportToSinglePage();
  fitPreview();
}

function fitHeroForSinglePage() {
  const area = document.getElementById("printArea");
  const hero = document.getElementById("prevHeroBox");
  if (!area || !hero) return;

  // Hero kekal menggunakan object-fit: cover; perubahan tinggi hanya crop
  // bahagian gambar, tidak pernah menarik atau menyekkan nisbah asalnya.
  hero.style.height = "";
  hero.style.aspectRatio = "16 / 9";
  const overflow = area.scrollHeight - area.clientHeight;
  if (overflow > 0) {
    const reducedHeight = Math.max(150, Math.round(hero.offsetHeight - overflow - 8));
    hero.style.aspectRatio = "auto";
    hero.style.height = `${reducedHeight}px`;
  }
}

function fitReportToSinglePage() {
  const area = document.getElementById("printArea");
  const content = document.getElementById("printContent");
  const notice = document.getElementById("reportFitNotice");
  if (!area || !content) return { scale: 1, tooLong: false };

  // Pada muatan awal, tab Borang masih tersembunyi dan tingginya terbaca 0.
  // Jangan anggap keadaan itu sebagai laporan terlalu panjang.
  if (area.clientHeight <= 0 || !area.getClientRects().length) {
    content.style.transform = "none";
    content.style.width = "100%";
    if (notice) notice.classList.add("hidden");
    return { scale: 1, tooLong: false };
  }

  content.style.transform = "none";
  content.style.width = "100%";
  fitHeroForSinglePage();

  const requiredScale = Math.min(1, (area.clientHeight - 1) / content.scrollHeight);
  const minimumReadableScale = 0.76;
  const scale = Math.max(minimumReadableScale, requiredScale);
  const tooLong = requiredScale < minimumReadableScale;

  // Lebarkan susun atur sebelum diskalakan supaya lebar laporan kekal sama;
  // semua elemen mengecil sekata dan tiada gambar 2–4 ditolak keluar halaman.
  content.style.width = `${100 / scale}%`;
  content.style.transform = `scale(${scale})`;
  if (notice) notice.classList.toggle("hidden", !tooLong);
  return { scale, tooLong };
}

function triggerPrint() {
  if (previewRenderFrame) flushPreview();
  const fit = fitReportToSinglePage();
  if (fit.tooLong) {
    alert("Laporan terlalu panjang untuk satu halaman A4. Sila ringkaskan isi laporan sebelum mencetak.");
    return;
  }
  window.print();
}

let savingReport = false;
let pendingSubmission = null;
let savedDownload;

function setReportMode(rowId) {
  document.getElementById("editRowId").value = rowId || "";
  document.getElementById("submitBtnText").textContent = rowId ? "Kemaskini & Muat Turun PDF" : "Simpan Laporan & Muat Turun PDF";
  const label = document.getElementById("reportMode");
  label.hidden = !rowId;
  label.textContent = rowId ? `Mode Edit · Rekod #${rowId}` : "";
}

function downloadSavedReport() {
  if (savedDownload) downloadBlob(savedDownload.blob, savedDownload.name);
}

function resetOprForm() {
  if (savingReport || pendingSubmission) return;
  if (!confirm("Adakah anda pasti untuk mengosongkan borang?")) return;
  document.getElementById("oprForm").reset();
  showFormPane("entry");
  setReportMode("");
  state.images = createImageState();
  for (let index = 1; index <= 4; index++) {
    document.getElementById(`fileImg${index}`).value = "";
    document.getElementById(`editImgBtn${index}`).classList.add("hidden");
  }
  document.getElementById("tarikhLaporan").value = new Date().toISOString().split("T")[0];
  document.getElementById("submitBtnText").innerText = "Simpan Laporan & Muat Turun PDF";
  updatePreview();
}

async function loadOprForEdit(summary) {
  if (savingReport || pendingSubmission) return;
  const previousId = document.getElementById("editRowId").value;
  let loaded = false;
  switchTab("form");
  showFormPane("entry");
  closeModal();
  const submitBtn = document.getElementById("submitBtn");
  const originalHtml = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Memuatkan laporan…</span>`;
  try {
    const response = await fetch(`${getApiUrl()}?action=getRecord&rowId=${encodeURIComponent(summary.id)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || result.status !== "success" || !result.record?.id) throw new Error("Butiran penuh laporan tidak dapat dimuatkan.");
    const data = result.record;

    document.getElementById("editRowId").value = data.id || "";
    document.getElementById("namaPegawai").value = data.namaPegawai || "";
    document.getElementById("jawatanPegawai").value = data.jawatanPegawai || "";
    document.getElementById("tarikhLaporan").value = formatDateForInput(data.tarikhLaporan);
    document.getElementById("tajukProgram").value = data.tajukProgram || "";
    document.getElementById("tarikhPelaksanaan").value = data.tarikhPelaksanaan || "";
    document.getElementById("masa").value = data.masa || "";
    document.getElementById("sasaran").value = data.sasaran || "";
    document.getElementById("pelibatan").value = data.pelibatan || "";
    document.getElementById("objektif").value = data.objektif || "";
    document.getElementById("kekuatan").value = data.kekuatan || "";
    document.getElementById("penambahbaikan").value = data.penambahbaikan || "";
    for (let index = 2; index <= 4; index++) {
      document.getElementById(`kapsyen${index}`).value = data[`kapsyen${index}`] || "";
    }

    state.images = createImageState();
    for (let index = 1; index <= 4; index++) {
      const imageData = data[`gambar${index}`] || "";
      state.images[index] = {
        dataUrl: imageData,
        existingRef: data[`gambarRef${index}`] || "",
        changed: false,
        sourceUrl: "",
        originalSource: imageData
      };
      document.getElementById(`fileImg${index}`).value = "";
      document.getElementById(`editImgBtn${index}`).classList.toggle("hidden", !imageData);
    }

    loaded = true;
      updatePreview();
  } catch (error) {
    alert(error.message || "Butiran laporan tidak dapat dimuatkan.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalHtml;
    setReportMode(loaded ? summary.id : previousId);
  }
}

function setProgress(step, status) {
  const element = document.getElementById(`step-${step}`);
  if (!element) return;
  element.dataset.status = status;
  const icon = element.querySelector(".step-icon");
  if (status === "active") icon.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
  if (status === "done") icon.innerHTML = `<i class="fa-solid fa-check"></i>`;
  if (status === "error") icon.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
}

function showSaveProgress() {
  ["images", "pdf", "drive", "done"].forEach(step => {
    const element = document.getElementById(`step-${step}`);
    element.dataset.status = "pending";
    const defaults = {
      images: "fa-solid fa-image",
      pdf: "fa-solid fa-file-pdf",
      drive: "fa-brands fa-google-drive",
      done: "fa-solid fa-flag-checkered"
    };
    element.querySelector(".step-icon").innerHTML = `<i class="${defaults[step]}"></i>`;
  });
  document.getElementById("saveProgressMessage").classList.add("hidden");
  document.getElementById("closeProgressBtn").classList.add("hidden");
  const modal = document.getElementById("saveProgressModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function showProgressError(step, message) {
  setProgress(step, "error");
  const box = document.getElementById("saveProgressMessage");
  box.textContent = message;
  box.classList.remove("hidden");
  document.getElementById("closeProgressBtn").classList.remove("hidden");
}

function closeSaveProgress() {
  const modal = document.getElementById("saveProgressModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function waitForPreviewImages() {
  const images = [...document.querySelectorAll("#printArea img")].filter(image => image.src && !image.classList.contains("hidden"));
  return Promise.all(images.map(image => {
    if (image.complete) return Promise.resolve();
    return new Promise(resolve => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 5000);
    });
  }));
}

let pdfLibraries;
function loadPdfLibraries() {
  if (!pdfLibraries) {
    const dependencies = [
      { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", ready: () => typeof window.jspdf?.jsPDF === "function" }
    ];
    pdfLibraries = Promise.all(dependencies.map(({ src, ready }) => {
      if (ready()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          if (ready()) resolve();
          else {
            script.remove();
            reject(new Error("Komponen PDF tidak dapat dimuatkan."));
          }
        };
        script.onerror = () => {
          script.remove();
          reject(new Error("Komponen PDF tidak dapat dimuatkan. Sila cuba lagi."));
        };
        document.head.appendChild(script);
      });
    })).catch(error => {
      pdfLibraries = undefined;
      throw error;
    });
  }
  return pdfLibraries;
}

async function generatePdfBlob() {
  await loadPdfLibraries();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const value = id => document.getElementById(id).value.trim();
  const clean = text => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u25cf/g, "\u2022");
  const title = value("tajukProgram") || "Laporan OPR";
  const gallery = [2, 3, 4].filter(index => state.images[index].dataUrl);
  const sections = [
    ["Tarikh Pelaksanaan", value("tarikhPelaksanaan")], ["Masa", value("masa")],
    ["Sasaran", value("sasaran")], ["Pelibatan", value("pelibatan")],
    ["Objektif Program", value("objektif")], ["Kekuatan", value("kekuatan")],
    ["Penambahbaikan", value("penambahbaikan")],
    ["Disediakan oleh", [value("namaPegawai"), value("jawatanPegawai"), value("tarikhLaporan")].filter(Boolean).join(" · ")]
  ].filter(([, text]) => text);
  const logo = document.querySelector("#printContent img");
  const drawImage = (source, x, y, width, height) => {
    const info = pdf.getImageProperties(source);
    const scale = Math.min(width / info.width, height / info.height);
    const w = info.width * scale, h = info.height * scale;
    pdf.addImage(source, info.fileType, x + (width - w) / 2, y + (height - h) / 2, w, h);
  };
  const wrap = (text, width) => clean(text).split(/\r?\n/).flatMap(line => line ? pdf.splitTextToSize(line, width) : [""]);
  pdf.setFont("helvetica", "bold").setFontSize(12);
  const titleLines = wrap(title, 187);
  const hero = state.images[1].dataUrl;
  const galleryWidth = gallery.length ? (194 - (gallery.length - 1) * 3) / gallery.length : 0;
  let layout;
  for (const option of [{ font: 9, line: 3.7, hero: 52, photo: 32 }, { font: 8, line: 3.25, hero: 42, photo: 27 }, { font: 7.5, line: 3, hero: 34, photo: 23 }]) {
    pdf.setFont("helvetica", "normal").setFontSize(option.font);
    const content = sections.map(([label, text]) => [label, wrap(text, 189)]);
    const captions = gallery.map(index => wrap(value("kapsyen" + index) || "Gambar " + index, galleryWidth - 2));
    const galleryHeight = gallery.length ? option.photo + 5 + Math.max(...captions.map(lines => lines.length)) * option.line : 0;
    const bottom = 32 + titleLines.length * 5 + (hero ? option.hero + 3 : 0)
      + content.reduce((sum, [, lines]) => sum + 7 + lines.length * option.line, 0) + galleryHeight;
    if (bottom <= 288) {
      layout = { ...option, content, captions };
      break;
    }
  }
  if (!layout) throw new Error("Laporan terlalu panjang untuk satu halaman A4. Sila ringkaskan isi laporan.");
  pdf.setProperties({ title, author: "PPD Petaling Utama", subject: "Laporan Ringkas Program / Aktiviti" });
  if (logo?.complete && logo.naturalWidth) drawImage(logo, 8, 7, 30, 17);
  pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(15, 23, 42);
  pdf.text("LAPORAN RINGKAS PROGRAM / AKTIVITI", 119, 12, { align: "center" });
  pdf.setFontSize(8).text("PEJABAT PENDIDIKAN DAERAH PETALING UTAMA", 119, 17, { align: "center" });
  pdf.setFont("helvetica", "italic").setFontSize(7);
  pdf.text("PENDIDIKAN BERMUTU, INSAN TERDIDIK, NEGARA SEJAHTERA", 119, 21, { align: "center" });
  pdf.setDrawColor(203, 213, 225).line(8, 26, 202, 26);
  let y = 32;
  pdf.setFont("helvetica", "bold").setFontSize(12);
  titleLines.forEach(line => { pdf.text(line, 8, y); y += 5; });
  if (hero) {
    drawImage(hero, 8, y, 194, layout.hero);
    y += layout.hero + 3;
  }
  for (const [label, lines] of layout.content) {
    pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(15, 23, 42);
    pdf.text(label, 8, y);
    y += 4;
    pdf.setFont("helvetica", "normal").setFontSize(layout.font).setTextColor(51, 65, 85);
    lines.forEach(line => { pdf.text(line, 8, y); y += layout.line; });
    y += 3;
  }
  gallery.forEach((index, position) => {
    const x = 8 + position * (galleryWidth + 3);
    drawImage(state.images[index].dataUrl, x, y, galleryWidth, layout.photo);
    pdf.setFont("helvetica", "normal").setFontSize(layout.font).setTextColor(51, 65, 85);
    layout.captions[position].forEach((line, offset) => pdf.text(line, x + 1, y + layout.photo + 4 + offset * layout.line));
  });
  return pdf.output("blob");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function safeFilePart(value) {
  return String(value || "OPR")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55) || "OPR";
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function handleSaveAndPrint(event) {
  event.preventDefault();
  if (savingReport || document.getElementById("submitBtn").disabled) return;
  if (previewRenderFrame) flushPreview();
  const editRowId = document.getElementById("editRowId").value || "";

  const submitBtn = document.getElementById("submitBtn");
  savingReport = true;
  submitBtn.disabled = true;
  showSaveProgress();
  document.getElementById("downloadSavedBtn").hidden = true;
  let currentStep = "images";
  try {
    if (!pendingSubmission) {
      setProgress("images", "active");
      await waitForPreviewImages();
      setProgress("images", "done");

      currentStep = "pdf";
      setProgress("pdf", "active");
      const pdfBlob = await generatePdfBlob();
      const pdfBase64 = await blobToBase64(pdfBlob);
      setProgress("pdf", "done");

      currentStep = "drive";
      setProgress("drive", "active");
      const title = document.getElementById("tajukProgram").value;
      const officer = document.getElementById("namaPegawai").value;
      const date = document.getElementById("tarikhLaporan").value;
      const pdfFileName = `OPR_${safeFilePart(title)}_${safeFilePart(officer)}_${date || "LAPORAN"}.pdf`;
      const payload = {
        action: "saveReport",
        submissionId: crypto.randomUUID(),
        editRowId,
        namaPegawai: officer,
        jawatanPegawai: document.getElementById("jawatanPegawai").value,
        tarikhLaporan: date,
        tajukProgram: title,
        tarikhPelaksanaan: document.getElementById("tarikhPelaksanaan").value,
        masa: document.getElementById("masa").value,
        sasaran: document.getElementById("sasaran").value,
        pelibatan: document.getElementById("pelibatan").value,
        objektif: document.getElementById("objektif").value,
        kekuatan: document.getElementById("kekuatan").value,
        penambahbaikan: document.getElementById("penambahbaikan").value,
        gambar1: state.images[1].changed ? state.images[1].dataUrl : "",
        gambar2: state.images[2].changed ? state.images[2].dataUrl : "",
        kapsyen2: document.getElementById("kapsyen2").value,
        gambar3: state.images[3].changed ? state.images[3].dataUrl : "",
        kapsyen3: document.getElementById("kapsyen3").value,
        gambar4: state.images[4].changed ? state.images[4].dataUrl : "",
        kapsyen4: document.getElementById("kapsyen4").value,
        pdfBase64,
        pdfFileName
      };

      pendingSubmission = { body: JSON.stringify(payload), blob: pdfBlob, name: pdfFileName, images: Object.values(state.images).map(image => image.dataUrl) };
    } else {
      setProgress("images", "done");
      setProgress("pdf", "done");
    }

    currentStep = "drive";
    setProgress("drive", "active");
    const submission = pendingSubmission;
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: submission.body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.status !== "success" || !Number.isInteger(Number(result.rowId)) || Number(result.rowId) < 2) throw new Error(result.message || "Pengesahan rekod belum diterima");
    setReportMode(result.rowId);
      pendingSubmission = null;
    Object.values(state.images).forEach((image, index) => {
      if (image.dataUrl === submission.images[index]) image.changed = false;
    });
    savedDownload = { blob: submission.blob, name: submission.name };
    document.getElementById("downloadSavedBtn").hidden = false;
    setProgress("drive", "done");

    currentStep = "done";
    setProgress("done", "active");
    downloadSavedReport();
    setProgress("done", "done");
    document.getElementById("closeProgressBtn").classList.remove("hidden");
    loadData(true);
  } catch (error) {
    console.error("Ralat simpan:", error);
    const message = pendingSubmission ? "Status simpanan belum dapat disahkan. Tutup mesej ini dan tekan Cuba Semula untuk menghantar salinan laporan yang sama." : `Proses tidak selesai: ${error.message || error}`;
    showProgressError(currentStep, message);
  } finally {
    savingReport = false;
    submitBtn.disabled = false;
    if (pendingSubmission) document.getElementById("submitBtnText").textContent = "Cuba Semula";
  }
}

function showFormPane(pane) {
  const section = document.getElementById("sec-form");
  section.dataset.pane = pane;
  section.querySelectorAll(".opr-mobile-nav button").forEach((button, index) => button.setAttribute("aria-pressed", String(index === (pane === "entry" ? 0 : 1))));
  updatePreview();
}
