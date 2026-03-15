"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  type Account,
  type ClinicianPatientSummary,
  type ClinicianAllPatientItem,
  type MedicationItem,
  type AppointmentItem,
} from "../../../lib/api";

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

type View = "patients" | "patient-detail";

export default function ClinicianDashboard() {
  const params = useParams<{ accountId: string }>();
  const router = useRouter();
  const accountId = decodeURIComponent(
    Array.isArray(params.accountId) ? params.accountId[0] : params.accountId ?? ""
  );

  // Auth
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("bytecare_account") || localStorage.getItem("bytecare_account");
    if (!raw) { router.replace("/auth/signin"); return; }
    try {
      const acc = JSON.parse(raw) as Account;
      if (acc.role !== "clinician") { router.replace("/auth/signin"); return; }
      setAccount(acc);
    } catch { router.replace("/auth/signin"); }
  }, [router]);

  // View state
  const [view, setView] = useState<View>("patients");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Patient list
  const [myPatients, setMyPatients] = useState<ClinicianPatientSummary[]>([]);

  // Assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [allPatients, setAllPatients] = useState<ClinicianAllPatientItem[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);

  // Patient detail
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState(0);
  const [patientConditions, setPatientConditions] = useState<string[]>([]);
  const [patientMeds, setPatientMeds] = useState<MedicationItem[]>([]);
  const [patientAppts, setPatientAppts] = useState<AppointmentItem[]>([]);

  // Conditions edit
  const [editingConditions, setEditingConditions] = useState(false);
  const [conditionsText, setConditionsText] = useState("");
  const [conditionsSaving, setConditionsSaving] = useState(false);

  // Med form
  const [showMedForm, setShowMedForm] = useState(false);
  const [editMedId, setEditMedId] = useState<string | null>(null);
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [medFreq, setMedFreq] = useState("once_daily");
  const [medTimes, setMedTimes] = useState("08:00");
  const [medWindow, setMedWindow] = useState("120");
  const [medCrit, setMedCrit] = useState("medium");
  const [medSaving, setMedSaving] = useState(false);
  const [medMsg, setMedMsg] = useState<string | null>(null);

  // Appt form
  const [showApptForm, setShowApptForm] = useState(false);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [apptDatetime, setApptDatetime] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptNotes, setApptNotes] = useState("");
  const [apptSaving, setApptSaving] = useState(false);
  const [apptMsg, setApptMsg] = useState<string | null>(null);

  // Load my patients
  const loadMyPatients = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.clinicianGetPatients(accountId);
      setMyPatients(res.items ?? []);
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (account) void loadMyPatients();
  }, [account, loadMyPatients]);

  // Load all patients for assign
  async function loadAllPatients() {
    setAssignLoading(true);
    try {
      const res = await api.clinicianGetAllPatients(accountId);
      setAllPatients(res.items ?? []);
    } catch { setAllPatients([]); }
    finally { setAssignLoading(false); }
  }

  async function handleAssign(patientUserId: string) {
    try {
      await api.clinicianAssignPatient(accountId, patientUserId);
      await loadAllPatients();
      await loadMyPatients();
    } catch (e) {
      setError(safeMessage(e));
    }
  }

  async function handleUnassign(patientUserId: string) {
    try {
      await api.clinicianUnassignPatient(accountId, patientUserId);
      await loadMyPatients();
      if (selectedPatientId === patientUserId) {
        setView("patients");
        setSelectedPatientId(null);
      }
    } catch (e) {
      setError(safeMessage(e));
    }
  }

  // Open patient detail
  async function openPatientDetail(patientUserId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.clinicianGetPatientDetail(accountId, patientUserId);
      setSelectedPatientId(patientUserId);
      setPatientName(res.patient.name);
      setPatientAge(res.patient.age);
      setPatientConditions(res.patient.conditions ?? []);
      setPatientMeds(res.medications ?? []);
      setPatientAppts(res.appointments ?? []);
      setView("patient-detail");
    } catch (e) {
      setError(safeMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function reloadPatientDetail() {
    if (!selectedPatientId) return;
    try {
      const res = await api.clinicianGetPatientDetail(accountId, selectedPatientId);
      setPatientConditions(res.patient.conditions ?? []);
      setPatientMeds(res.medications ?? []);
      setPatientAppts(res.appointments ?? []);
    } catch {}
  }

  // Conditions
  function startEditConditions() {
    setConditionsText(patientConditions.join(", "));
    setEditingConditions(true);
  }

  async function handleSaveConditions() {
    if (!selectedPatientId) return;
    setConditionsSaving(true);
    try {
      const conditions = conditionsText.split(",").map(c => c.trim()).filter(Boolean);
      await api.clinicianUpdateConditions(accountId, selectedPatientId, conditions);
      setPatientConditions(conditions);
      setEditingConditions(false);
    } catch (e) { setError(safeMessage(e)); }
    finally { setConditionsSaving(false); }
  }

  // Med CRUD
  function resetMedForm() {
    setShowMedForm(false); setEditMedId(null);
    setMedName(""); setMedDose(""); setMedFreq("once_daily");
    setMedTimes("08:00"); setMedWindow("120"); setMedCrit("medium"); setMedMsg(null);
  }

  function startEditMed(med: MedicationItem) {
    setEditMedId(med.medication_id);
    setMedName(med.name); setMedDose(med.dose_text);
    setMedFreq(med.schedule.frequency); setMedTimes(med.schedule.times.join(", "));
    setMedWindow(String(med.time_window_minutes)); setMedCrit(med.criticality);
    setShowMedForm(true); setMedMsg(null);
  }

  async function handleSaveMed() {
    if (!selectedPatientId) return;
    if (!medName.trim()) { setMedMsg("Name is required."); return; }
    const times = medTimes.split(",").map(t => t.trim()).filter(Boolean);
    const payload = {
      name: medName.trim(), dose_text: medDose.trim(),
      schedule: { frequency: medFreq, times },
      time_window_minutes: parseInt(medWindow, 10) || 120, criticality: medCrit,
    };
    setMedSaving(true); setMedMsg(null);
    try {
      if (editMedId) {
        await api.clinicianUpdateMedication(accountId, selectedPatientId, editMedId, payload);
      } else {
        await api.clinicianAddMedication(accountId, selectedPatientId, payload);
      }
      resetMedForm();
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setMedMsg(safeMessage(e)); }
    finally { setMedSaving(false); }
  }

  async function handleDeleteMed(medId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteMedication(accountId, selectedPatientId, medId);
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setMedMsg(safeMessage(e)); }
  }

  // Appt CRUD
  function resetApptForm() {
    setShowApptForm(false); setEditApptId(null);
    setApptDatetime(""); setApptLocation(""); setApptNotes(""); setApptMsg(null);
  }

  function startEditAppt(appt: AppointmentItem) {
    setEditApptId(appt.appointment_id);
    setApptDatetime(appt.datetime.slice(0, 16));
    setApptLocation(appt.location); setApptNotes(appt.notes);
    setShowApptForm(true); setApptMsg(null);
  }

  async function handleSaveAppt() {
    if (!selectedPatientId) return;
    if (!apptDatetime) { setApptMsg("Date & time required."); return; }
    const payload = { datetime: apptDatetime, location: apptLocation.trim(), notes: apptNotes.trim() };
    setApptSaving(true); setApptMsg(null);
    try {
      if (editApptId) {
        await api.clinicianUpdateAppointment(accountId, selectedPatientId, editApptId, payload);
      } else {
        await api.clinicianAddAppointment(accountId, selectedPatientId, payload);
      }
      resetApptForm();
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setApptMsg(safeMessage(e)); }
    finally { setApptSaving(false); }
  }

  async function handleDeleteAppt(apptId: string) {
    if (!selectedPatientId) return;
    try {
      await api.clinicianDeleteAppointment(accountId, selectedPatientId, apptId);
      await reloadPatientDetail();
      await loadMyPatients();
    } catch (e) { setApptMsg(safeMessage(e)); }
  }

  function handleSignOut() {
    sessionStorage.removeItem("bytecare_account");
    localStorage.removeItem("bytecare_account");
    router.replace("/auth/signin");
  }

  if (!account) return null;

  return (
    <main className="demo-shell">
      <div className="phone-frame auth-frame">
        <header className="app-header">
          <div className="header-left">
            {view === "patient-detail" ? (
              <button type="button" className="icon-button" onClick={() => { setView("patients"); setSelectedPatientId(null); }}>
                &larr;
              </button>
            ) : null}
            <div className="avatar">CL</div>
            <div className="header-copy">
              <h1>ByteCare</h1>
              <p className="muted">{account.name} (Clinician)</p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={handleSignOut}>Sign Out</button>
        </header>

        <section className="tab-body">
          {error ? <p className="status-error">{error}</p> : null}

          {/* ============ PATIENT LIST VIEW ============ */}
          {view === "patients" ? (
            <>
              <section className="card">
                <div className="card-row">
                  <div className="card-title">My Patients</div>
                  <button type="button" className="icon-button" onClick={() => { setShowAssign(true); void loadAllPatients(); }}>
                    + Assign
                  </button>
                </div>

                {loading ? <p className="muted">Loading...</p> : null}

                {!loading && myPatients.length === 0 ? (
                  <div className="empty-state">
                    <p>No patients assigned yet.</p>
                    <p className="muted">Use &ldquo;+ Assign&rdquo; to add patients to your care list.</p>
                  </div>
                ) : null}

                <div className="item-list">
                  {myPatients.map((p) => (
                    <div key={p.user_id} className="item-row" style={{ cursor: "pointer" }} onClick={() => void openPatientDetail(p.user_id)}>
                      <div>
                        <div className="item-name">{p.name}</div>
                        <div className="muted">
                          Age {p.age} &middot; {p.medication_count} med(s) &middot; {p.appointment_count} appt(s)
                        </div>
                        {p.conditions.length > 0 ? (
                          <div className="muted" style={{ fontSize: "0.75rem" }}>{p.conditions.join(", ")}</div>
                        ) : null}
                      </div>
                      <div className="item-actions">
                        <button type="button" className="icon-button danger-btn" onClick={(e) => { e.stopPropagation(); void handleUnassign(p.user_id); }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Assign Patient Modal */}
              {showAssign ? (
                <section className="card">
                  <div className="card-row">
                    <div className="card-title">Assign a Patient</div>
                    <button type="button" className="icon-button" onClick={() => setShowAssign(false)}>Close</button>
                  </div>

                  {assignLoading ? <p className="muted">Loading patients...</p> : null}

                  <div className="item-list">
                    {allPatients.map((p) => {
                      const isAssignedToMe = myPatients.some(mp => mp.user_id === p.user_id);
                      const isAssignedToOther = !isAssignedToMe && !!p.assigned_clinician_id;
                      return (
                        <div key={p.user_id} className="item-row">
                          <div>
                            <div className="item-name">{p.name}</div>
                            <div className="muted">
                              Age {p.age}
                              {isAssignedToMe ? " — Assigned to you" : ""}
                              {isAssignedToOther ? " — Assigned to another clinician" : ""}
                            </div>
                          </div>
                          <div className="item-actions">
                            {!isAssignedToMe && !isAssignedToOther ? (
                              <button type="button" className="icon-button" onClick={() => void handleAssign(p.user_id)}>
                                Assign
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {/* ============ PATIENT DETAIL VIEW ============ */}
          {view === "patient-detail" && selectedPatientId ? (
            <>
              {/* Patient Info */}
              <section className="card">
                <div className="card-title">{patientName}</div>
                <p className="muted">Age: {patientAge}</p>

                <div className="card-row" style={{ marginTop: "0.5rem" }}>
                  <strong style={{ fontSize: "0.85rem" }}>Conditions</strong>
                  {!editingConditions ? (
                    <button type="button" className="icon-button" onClick={startEditConditions}>Edit</button>
                  ) : null}
                </div>

                {!editingConditions ? (
                  <p className="muted">{patientConditions.length > 0 ? patientConditions.join(", ") : "None listed"}</p>
                ) : (
                  <div className="form-group">
                    <input
                      value={conditionsText}
                      onChange={(e) => setConditionsText(e.target.value)}
                      placeholder="e.g. Hypertension, Diabetes"
                    />
                    <button type="button" onClick={() => void handleSaveConditions()} disabled={conditionsSaving}>
                      {conditionsSaving ? "Saving..." : "Save"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setEditingConditions(false)}>Cancel</button>
                  </div>
                )}
              </section>

              {/* Medications */}
              <section className="card">
                <div className="card-row">
                  <div className="card-title">Medications</div>
                  <button type="button" className="icon-button" onClick={() => { resetMedForm(); setShowMedForm(true); }}>+ Add</button>
                </div>

                {showMedForm ? (
                  <div className="form-group">
                    <label className="form-label">Medication Name</label>
                    <input value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="e.g. Amlodipine 5mg" />
                    <label className="form-label">Dose Text</label>
                    <input value={medDose} onChange={(e) => setMedDose(e.target.value)} placeholder="e.g. 5mg" />
                    <label className="form-label">Frequency</label>
                    <select value={medFreq} onChange={(e) => setMedFreq(e.target.value)}>
                      <option value="once_daily">Once daily</option>
                      <option value="twice_daily">Twice daily</option>
                      <option value="thrice_daily">Thrice daily</option>
                      <option value="as_needed">As needed</option>
                    </select>
                    <label className="form-label">Times (comma-separated)</label>
                    <input value={medTimes} onChange={(e) => setMedTimes(e.target.value)} placeholder="08:00" />
                    <label className="form-label">Window (minutes)</label>
                    <input type="number" value={medWindow} onChange={(e) => setMedWindow(e.target.value)} />
                    <label className="form-label">Criticality</label>
                    <select value={medCrit} onChange={(e) => setMedCrit(e.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    {medMsg ? <p className="status-error">{medMsg}</p> : null}
                    <button type="button" onClick={() => void handleSaveMed()} disabled={medSaving}>
                      {medSaving ? "Saving..." : editMedId ? "Update Medication" : "Add Medication"}
                    </button>
                    <button type="button" className="secondary-button" onClick={resetMedForm}>Cancel</button>
                  </div>
                ) : null}

                {patientMeds.length === 0 ? (
                  <p className="muted">No medications prescribed yet.</p>
                ) : (
                  <div className="item-list">
                    {patientMeds.map((med) => (
                      <div key={med.medication_id} className="item-row">
                        <div>
                          <div className="item-name">{med.name}</div>
                          <div className="muted">{med.dose_text} &middot; {med.schedule.frequency} &middot; {med.schedule.times.join(", ")} &middot; {med.criticality}</div>
                        </div>
                        <div className="item-actions">
                          <button type="button" className="icon-button" onClick={() => startEditMed(med)}>Edit</button>
                          <button type="button" className="icon-button danger-btn" onClick={() => void handleDeleteMed(med.medication_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Appointments */}
              <section className="card">
                <div className="card-row">
                  <div className="card-title">Appointments</div>
                  <button type="button" className="icon-button" onClick={() => { resetApptForm(); setShowApptForm(true); }}>+ Add</button>
                </div>

                {showApptForm ? (
                  <div className="form-group">
                    <label className="form-label">Date &amp; Time</label>
                    <input type="datetime-local" value={apptDatetime} onChange={(e) => setApptDatetime(e.target.value)} />
                    <label className="form-label">Location</label>
                    <input value={apptLocation} onChange={(e) => setApptLocation(e.target.value)} placeholder="e.g. Polyclinic" />
                    <label className="form-label">Notes</label>
                    <textarea value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} placeholder="e.g. Follow-up visit" />
                    {apptMsg ? <p className="status-error">{apptMsg}</p> : null}
                    <button type="button" onClick={() => void handleSaveAppt()} disabled={apptSaving}>
                      {apptSaving ? "Saving..." : editApptId ? "Update Appointment" : "Add Appointment"}
                    </button>
                    <button type="button" className="secondary-button" onClick={resetApptForm}>Cancel</button>
                  </div>
                ) : null}

                {patientAppts.length === 0 ? (
                  <p className="muted">No appointments scheduled.</p>
                ) : (
                  <div className="item-list">
                    {patientAppts.map((appt) => (
                      <div key={appt.appointment_id} className="item-row">
                        <div>
                          <div className="item-name">{new Date(appt.datetime).toLocaleString()}</div>
                          <div className="muted">{appt.location}{appt.notes ? ` — ${appt.notes}` : ""}</div>
                        </div>
                        <div className="item-actions">
                          <button type="button" className="icon-button" onClick={() => startEditAppt(appt)}>Edit</button>
                          <button type="button" className="icon-button danger-btn" onClick={() => void handleDeleteAppt(appt.appointment_id)}>Del</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {apptMsg && !showApptForm ? <p className="status-error">{apptMsg}</p> : null}
              </section>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
