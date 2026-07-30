const $=(value)=>document.querySelector(value), $$=(value)=>[...document.querySelectorAll(value)];
const state={user:null,devices:[],jobs:[],reports:[],settings:null,policies:[],profiles:[]};
const escapeHTML=(value="")=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtBytes=(bytes=0)=>{if(!bytes)return"—";const u=["B","KB","MB","GB","TB"];let v=bytes,i=0;while(v>=1000&&i<u.length-1){v/=1000;i++}return`${v.toFixed(i>2?2:0)} ${u[i]}`};
const fmtSpeed=(value)=>value?`${fmtBytes(value)}/s`:"—";
const fmtDate=(value)=>value?new Date(value).toLocaleString():"—";
const statusLabel=(value)=>String(value||"unknown").replaceAll("_"," ");
function notify(message,error=false){const n=$("#notice");n.textContent=message;n.hidden=false;n.style.background=error?"var(--error-container)":"";n.style.color=error?"var(--error)":"";setTimeout(()=>n.hidden=true,6000)}
async function api(path,options={}){
  const response=await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  if(response.status===401||response.status===403){if(path!=="/api/v1/auth/session")showLogin();throw new Error("Authentication required")}
  const content=response.headers.get("content-type")||"";const body=content.includes("json")?await response.json():await response.text();
  if(!response.ok)throw new Error(body.error||`Request failed (${response.status})`);return body;
}
function showLogin(){$("#app-view").hidden=true;$("#login-view").hidden=false;state.user=null}
function showApp(user){state.user=user;$("#login-view").hidden=true;$("#app-view").hidden=false;$("#user-menu").textContent=`${user.username} · Sign out`;$$(".admin-only").forEach(x=>x.hidden=user.role!=="admin")}
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const user=await api("/api/v1/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});showApp(user);await refreshAll()}catch(error){$("#login-error").textContent=error.message;$("#login-error").hidden=false}});
$("#user-menu").addEventListener("click",async()=>{await api("/api/v1/auth/logout",{method:"POST"}).catch(()=>{});showLogin()});
$$(".nav-item").forEach(button=>button.addEventListener("click",()=>{$$(".nav-item,.page").forEach(x=>x.classList.remove("active"));button.classList.add("active");$(`.page[data-page="${button.dataset.page}"]`).classList.add("active")}));
function deviceCard(d){
 const p=d.probe||{},reason=d.reason?`<p class="reason">${escapeHTML(d.reason)}</p>`:"";
 const actions=state.user.role==="viewer"?"":`<button class="filled start" data-id="${escapeHTML(d.id)}">Run test</button>${d.status==="quarantined"?`<button class="tonal retry" data-id="${escapeHTML(d.id)}">Retry probe</button>`:""}`;
 return`<article class="device-card"><div class="device-title"><div><h3>${escapeHTML(p.model||d.name||d.id)}</h3><p class="path">${escapeHTML(d.path)}</p></div><span class="status status-${escapeHTML(d.status)}">${escapeHTML(statusLabel(d.status))}</span></div>
 <div class="facts"><div class="fact"><span>Serial</span><strong>${escapeHTML(p.serial||"—")}</strong></div><div class="fact"><span>Capacity</span><strong>${fmtBytes(p.capacityBytes)}</strong></div><div class="fact"><span>Temperature</span><strong>${p.temperatureC?`${p.temperatureC} °C`:"—"}</strong></div><div class="fact"><span>SMART</span><strong>${p.smartAvailable?(p.smartPassed?"Passed":"Failed"):"Unavailable"}</strong></div><div class="fact"><span>Pending sectors</span><strong>${p.pendingSectors??"—"}</strong></div><div class="fact"><span>FARM</span><strong>${p.farmAvailable?"Available":"Unavailable"}</strong></div></div>${reason}<div class="card-actions">${actions}</div></article>`}
function jobRows(jobs){
 if(!jobs.length)return`<div class="empty">No tests have been created.</div>`;
 return`<table><thead><tr><th>Drive / test</th><th>Status</th><th>Progress</th><th>Performance</th><th>Created</th><th>Actions</th></tr></thead><tbody>${jobs.map(j=>{
  const active=["queued","validating","running","pause_requested"].includes(j.status),reportable=["completed","completed_with_warnings","failed","cancelled","interrupted"].includes(j.status);
  let actions="";if(state.user.role!=="viewer"){if(j.status==="running"&&["surface_read","destructive_verify"].includes(j.kind))actions+=`<button data-action="pause" data-id="${j.id}">Pause</button>`;if(["paused","interrupted"].includes(j.status))actions+=`<button data-action="resume" data-id="${j.id}">Resume</button>`;if(active||j.status==="paused")actions+=`<button data-action="cancel" data-id="${j.id}">Cancel</button>`;if(reportable)actions+=`<button data-action="report" data-id="${j.id}">PDF</button>`}
  return`<tr><td><strong>${escapeHTML(j.devicePath)}</strong><br><small>${escapeHTML(statusLabel(j.kind))}</small></td><td><span class="status status-${j.status}">${escapeHTML(statusLabel(j.status))}</span>${j.error?`<br><small>${escapeHTML(j.error)}</small>`:""}</td><td><div class="progress"><i style="width:${Math.max(0,Math.min(100,(j.progress||0)*100))}%"></i></div><small>${((j.progress||0)*100).toFixed(1)}%</small></td><td>${fmtSpeed(j.readBps)}<br><small>${j.readIops?`${j.readIops.toFixed(1)} IOPS`:""}</small></td><td>${fmtDate(j.createdAt)}</td><td><div class="actions">${actions}</div></td></tr>`
 }).join("")}</tbody></table>`}
function reportRows(){
 if(!state.reports.length)return`<div class="empty">Generate a PDF from a completed test.</div>`;
 return`<table><thead><tr><th>Report</th><th>Test</th><th>Verdict</th><th>Created</th><th>Integrity</th><th>Download</th></tr></thead><tbody>${state.reports.map(r=>`<tr><td><strong>${escapeHTML(r.id)}</strong></td><td>${escapeHTML(r.jobId)}</td><td><span class="status status-${r.verdict==="fail"?"failed":"completed"}">${escapeHTML(r.verdict)}</span></td><td>${fmtDate(r.createdAt)}</td><td><button data-verify="${r.id}">Verify</button></td><td><a href="/api/v1/reports/${encodeURIComponent(r.id)}/download">PDF</a> · <a href="/api/v1/reports/${encodeURIComponent(r.id)}/checksum">SHA-256</a></td></tr>`).join("")}</tbody></table>`}
async function refreshAll(){
 try{
  const [devices,jobs,reports,settings,policies,profiles]=await Promise.all([api("/api/v1/devices"),api("/api/v1/jobs"),api("/api/v1/reports"),api("/api/v1/settings"),api("/api/v1/policies"),api("/api/v1/profiles")]);
  Object.assign(state,{devices:devices.devices,jobs:jobs.jobs,reports:reports.reports,settings,policies:policies.policies,profiles:profiles.profiles});
  $("#test-form").elements.profileId.innerHTML=state.profiles.filter(p=>p.enabled).map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}${p.builtIn?"":" · advanced"}</option>`).join("");
  $("#test-form").elements.policyId.innerHTML=state.policies.map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · v${p.version}</option>`).join("");
  $("#devices").innerHTML=state.devices.length?state.devices.map(deviceCard).join(""):`<div class="empty">No physical drives discovered.</div>`;
  $("#jobs").innerHTML=jobRows(state.jobs);$("#recent-jobs").innerHTML=jobRows(state.jobs.slice(0,5));$("#reports").innerHTML=reportRows();
  $("#summary").innerHTML=[["Drives",state.devices.length],["Ready",state.devices.filter(d=>d.status==="ready").length],["Quarantined",state.devices.filter(d=>d.status==="quarantined").length],["Active tests",state.jobs.filter(j=>["queued","validating","running"].includes(j.status)).length]].map(([l,v])=>`<div class="summary-card"><span>${l}</span><strong>${v}</strong></div>`).join("");
  $("#daemon-state").textContent="Daemon responsive";$("#daemon-state").className="status status-ready";$("#updated").textContent=`Updated ${new Date().toLocaleTimeString()}`;
  if(state.user.role==="admin")await refreshAdmin();
 }catch(error){$("#daemon-state").textContent="Connection lost";$("#daemon-state").className="status status-quarantined";notify(error.message,true)}
}
async function refreshAdmin(){
 const [users,audit]=await Promise.all([api("/api/v1/users"),api("/api/v1/audit")]);
 const f=$("#settings-form"),s=state.settings;for(const name of["organization","maxConcurrentJobs","maxDestructiveJobs","jobChunkMiB","retentionDays","retentionMaxBytes"])f.elements[name].value=s[name];f.elements.destructiveEnabled.checked=s.destructiveEnabled;
 $("#users-list").innerHTML=users.users.map(u=>`<div class="user-row"><span>${escapeHTML(u.username)}</span><small>${escapeHTML(u.role)}</small></div>`).join("");
 $("#audit").innerHTML=`<table><thead><tr><th>Time</th><th>Action</th><th>User</th><th>Target</th></tr></thead><tbody>${audit.events.map(e=>`<tr><td>${fmtDate(e.at)}</td><td>${escapeHTML(e.action)}</td><td>${escapeHTML(e.userId||"system")}</td><td>${escapeHTML(e.target||"—")}</td></tr>`).join("")}</tbody></table>`;
}
async function refreshDevices(){try{await api("/api/v1/discovery/refresh",{method:"POST"});notify("Drive discovery started");setTimeout(refreshAll,1000)}catch(e){notify(e.message,true)}}
$("#refresh").addEventListener("click",refreshDevices);$("#refresh-devices").addEventListener("click",refreshDevices);
$("#devices").addEventListener("click",async e=>{
 const retry=e.target.closest(".retry");if(retry){await api(`/api/v1/devices/${encodeURIComponent(retry.dataset.id)}/retry`,{method:"POST"});notify("Manual probe scheduled");return}
 const start=e.target.closest(".start");if(!start)return;const d=state.devices.find(x=>x.id===start.dataset.id),p=d.probe||{},form=$("#test-form");form.elements.deviceId.value=d.id;form.elements.serialConfirmation.value="";form.elements.reauthPassword.value="";$("#test-drive-name").textContent=p.model||d.name;form.dataset.serial=p.serial||"";const selected=state.profiles.find(x=>x.id===form.elements.profileId.value);$("#destructive-warning").hidden=selected?.kind!=="destructive_verify";$("#test-dialog").showModal();
});
$("#test-form").elements.profileId.addEventListener("change",e=>{const p=state.profiles.find(x=>x.id===e.target.value);$("#destructive-warning").hidden=p?.kind!=="destructive_verify"});
$("#test-form").addEventListener("submit",async e=>{
 if(e.submitter?.value==="cancel")return;e.preventDefault();const f=new FormData(e.currentTarget),body=Object.fromEntries(f);
 try{await api("/api/v1/jobs",{method:"POST",body:JSON.stringify(body)});$("#test-dialog").close();notify("Test queued");await refreshAll()}catch(error){notify(error.message,true)}
});
$("#jobs").addEventListener("click",jobClick);$("#recent-jobs").addEventListener("click",jobClick);
async function jobClick(e){const b=e.target.closest("[data-action]");if(!b)return;try{if(b.dataset.action==="report")await api(`/api/v1/jobs/${b.dataset.id}/report`,{method:"POST"});else await api(`/api/v1/jobs/${b.dataset.id}/${b.dataset.action}`,{method:"POST"});notify(`${b.dataset.action} requested`);await refreshAll()}catch(error){notify(error.message,true)}}
$("#reports").addEventListener("click",async e=>{const b=e.target.closest("[data-verify]");if(!b)return;try{const v=await api(`/api/v1/reports/${b.dataset.verify}/verify`);notify(v.valid?"PDF checksum is valid":"PDF has been modified",!v.valid)}catch(error){notify(error.message,true)}});
$("#settings-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),old=state.settings,body={...old,organization:f.get("organization"),maxConcurrentJobs:Number(f.get("maxConcurrentJobs")),maxDestructiveJobs:Number(f.get("maxDestructiveJobs")),jobChunkMiB:Number(f.get("jobChunkMiB")),retentionDays:Number(f.get("retentionDays")),retentionMaxBytes:Number(f.get("retentionMaxBytes")),destructiveEnabled:f.get("destructiveEnabled")==="on"};try{await api("/api/v1/settings",{method:"PUT",body:JSON.stringify(body)});notify("Settings saved");await refreshAll()}catch(error){notify(error.message,true)}});
$("#user-form").addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/v1/users",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("User created");await refreshAdmin()}catch(error){notify(error.message,true)}});
$("#password-form").addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/v1/auth/password",{method:"POST",body:JSON.stringify(body)});showLogin();notify("Password changed. Sign in again.")}catch(error){notify(error.message,true)}});
$("#profile-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get("name"),kind:f.get("kind"),blockSizeKiB:Number(f.get("blockSizeKiB")),queueDepth:Number(f.get("queueDepth")),durationSeconds:Number(f.get("durationSeconds")),rateMiB:Number(f.get("rateMiB"))};try{await api("/api/v1/profiles",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("Advanced profile created");await refreshAll()}catch(error){notify(error.message,true)}});
$("#policy-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get("name"),failOnSmart:f.get("failOnSmart")==="on",failOnIoError:f.get("failOnIoError")==="on",warnPendingAbove:Number(f.get("warnPendingAbove")),warnReallocatedAbove:Number(f.get("warnReallocatedAbove")),warnUncorrectableAbove:Number(f.get("warnUncorrectableAbove"))};try{await api("/api/v1/policies",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("Grading policy created");await refreshAll()}catch(error){notify(error.message,true)}});
(async()=>{try{const user=await api("/api/v1/auth/session");showApp(user);await refreshAll()}catch{showLogin()}})();
setInterval(()=>{if(state.user)refreshAll()},3000);
