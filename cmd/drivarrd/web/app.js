const $=(value)=>document.querySelector(value), $$=(value)=>[...document.querySelectorAll(value)];
const state={user:null,devices:[],jobs:[],reports:[],settings:null,policies:[],profiles:[]};
let selectedDeviceId=null,selectedWorkspaceJob=null;
let liveRefreshInFlight=false;
const escapeHTML=(value="")=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtBytes=(bytes=0)=>{if(!bytes)return"—";const u=["B","KB","MB","GB","TB"];let v=bytes,i=0;while(v>=1000&&i<u.length-1){v/=1000;i++}return`${v.toFixed(i>2?2:0)} ${u[i]}`};
const fmtSpeed=(value)=>value?`${fmtBytes(value)}/s`:"—";
const fmtDate=(value)=>value?new Date(value).toLocaleString():"—";
const statusLabel=(value)=>String(value||"unknown").replaceAll("_"," ");
const deviceURL=id=>`/drives/${encodeURIComponent(id)}`;
const deviceIDFromURL=()=>location.pathname.startsWith("/drives/")?decodeURIComponent(location.pathname.slice(8).split("/")[0]||""):null;
function smartSelfTestLabel(test){
 if(!test)return"Not running";
 const kind=String(test.kind||"SMART self-test").replace(/\s+in progress$/i,"");
 return Number.isFinite(test.progressPercent)?`${kind} · ${test.progressPercent}%`:`${kind} · in progress`
}
function flattenFARM(value,prefix="",rows=[]){
 if(value===null||value===undefined)return rows;
 if(Array.isArray(value)){value.forEach((item,index)=>flattenFARM(item,`${prefix}[${index}]`,rows));return rows}
 if(typeof value==="object"){Object.entries(value).forEach(([key,item])=>flattenFARM(item,prefix?`${prefix}.${key}`:key,rows));return rows}
 rows.push([prefix||"value",String(value)]);return rows
}
function historyAssessment(probe={}){
 if(!probe.smartAvailable)return{kind:"indeterminate",label:"SMART history unavailable",evidence:["The device did not expose SMART lifetime counters."]}
 const farmRows=flattenFARM(probe.farm),numberFrom=value=>{const match=String(value).replaceAll(",","").match(/-?\d+(?:\.\d+)?/);return match?Number(match[0]):0};
 const farmHoursRow=farmRows.find(([key])=>/spindle.*hours|power.?on.*hours/i.test(key)),smartHours=Number(probe.powerOnHours||probe.smartAttributes?.find(a=>a.id===9)?.rawValue||0),farmHours=farmHoursRow?numberFrom(farmHoursRow[1]):0;
 if(smartHours>0&&farmHours>Math.max(smartHours*4,smartHours+1000))return{kind:"suspicious",label:"Possible SMART history reset",evidence:[`SMART reports ${smartHours.toLocaleString()} power-on hours while FARM reports ${farmHours.toLocaleString()} lifetime hours.`,"Independent lifetime counters are materially inconsistent. Review raw evidence before accepting the drive."]}
 if(probe.farmAvailable)return{kind:"consistent",label:"History counters consistent",evidence:["No material rollback was found between the available SMART and FARM lifetime counters."]}
 return{kind:"indeterminate",label:"No independent FARM cross-check",evidence:["SMART is available, but no independent FARM lifetime log was returned for comparison."]}
}
function notify(message,error=false){const n=$("#notice");n.textContent=message;n.hidden=false;n.style.background=error?"var(--error-container)":"";n.style.color=error?"var(--error)":"";setTimeout(()=>n.hidden=true,6000)}
async function api(path,options={}){
  const response=await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  if(response.status===401||response.status===403){if(path!=="/api/v1/auth/session")showLogin();throw new Error("Authentication required")}
  const content=response.headers.get("content-type")||"";const body=content.includes("json")?await response.json():await response.text();
  if(!response.ok)throw new Error(body.error||`Request failed (${response.status})`);return body;
}
function showLogin(){if($("#drive-workspace").open)$("#drive-workspace").close();$("#app-view").hidden=true;$("#login-view").hidden=false;state.user=null}
function showApp(user){state.user=user;$("#login-view").hidden=true;$("#app-view").hidden=false;$("#user-menu").textContent=`${user.username} · Sign out`;$$(".admin-only").forEach(x=>x.hidden=user.role!=="admin")}
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const user=await api("/api/v1/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});showApp(user);await refreshAll()}catch(error){$("#login-error").textContent=error.message;$("#login-error").hidden=false}});
$("#user-menu").addEventListener("click",async()=>{await api("/api/v1/auth/logout",{method:"POST"}).catch(()=>{});showLogin()});
$$(".nav-item").forEach(button=>button.addEventListener("click",()=>{$$(".nav-item,.page").forEach(x=>x.classList.remove("active"));button.classList.add("active");$(`.page[data-page="${button.dataset.page}"]`).classList.add("active")}));
function deviceCard(d){
 const p=d.probe||{},reason=d.reason?`<p class="reason">${escapeHTML(d.reason)}</p>`:"",history=historyAssessment(p),firmwareTest=p.smartSelfTest;
 const actions=state.user.role==="viewer"?"":`<button class="filled start" data-id="${escapeHTML(d.id)}">Run test</button>${d.status==="quarantined"?`<button class="tonal retry" data-id="${escapeHTML(d.id)}">Retry probe</button>`:""}`;
 return`<article class="device-card"><div class="device-title"><div><h3>${escapeHTML(p.model||d.name||d.id)}</h3><a class="path-link" href="${deviceURL(d.id)}" data-device-detail="${escapeHTML(d.id)}" title="Open full-screen drive workspace">${escapeHTML(d.path)} <span>OPEN ↗</span></a></div><span class="status status-${escapeHTML(d.status)}">${escapeHTML(statusLabel(d.status))}</span></div>
 <div class="facts"><div class="fact"><span>Serial</span><strong>${escapeHTML(p.serial||"—")}</strong></div><div class="fact"><span>Capacity</span><strong>${fmtBytes(p.capacityBytes)}</strong></div><div class="fact"><span>Drive interface</span><strong>${escapeHTML(p.deviceInterface||"—")}</strong></div><div class="fact"><span>Recording type</span><strong>${escapeHTML(p.recordingType||"—")}</strong></div><div class="fact"><span>Temperature</span><strong>${p.temperatureC?`${p.temperatureC} °C`:"—"}</strong></div><div class="fact"><span>SMART</span><strong>${p.smartAvailable?(p.smartPassed?"Passed":"Failed"):"Unavailable"}</strong></div><div class="fact"><span>Power-on hours</span><strong>${p.powerOnHours?.toLocaleString?.()||"—"}</strong></div><div class="fact"><span>Pending sectors</span><strong>${p.pendingSectors??"—"}</strong></div><div class="fact"><span>FARM</span><strong>${p.farmAvailable?"Available":"Unavailable"}</strong></div><div class="fact"><span>SMART history</span><strong>${escapeHTML(history.label)}</strong></div></div>${firmwareTest?`<div class="smart-test-banner"><span class="status status-running">running</span><div><strong>${escapeHTML(smartSelfTestLabel(firmwareTest))}</strong><small>Detected from the drive firmware</small></div></div>`:""}${reason}<div class="card-actions">${actions}</div></article>`}
function jobRows(jobs){
 if(!jobs.length)return`<div class="empty">No tests have been created.</div>`;
 return`<table><thead><tr><th>Drive / test</th><th>Status</th><th>Progress</th><th>Performance</th><th>Created</th><th>Actions</th></tr></thead><tbody>${jobs.map(j=>{
  const active=["queued","validating","running","pause_requested"].includes(j.status),reportable=["completed","completed_with_warnings","failed","cancelled","interrupted"].includes(j.status);
  let actions="";if(state.user.role!=="viewer"){if(j.status==="running"&&["surface_read","destructive_verify"].includes(j.kind))actions+=`<button data-action="pause" data-id="${j.id}">Pause</button>`;if(["paused","interrupted"].includes(j.status))actions+=`<button data-action="resume" data-id="${j.id}">Resume</button>`;if(active||j.status==="paused")actions+=`<button data-action="cancel" data-id="${j.id}">Cancel</button>`;if(reportable)actions+=`<button data-action="report" data-id="${j.id}">PDF</button>`}
	  const percent=Math.max(0,Math.min(100,(j.progress||0)*100));
	  return`<tr><td><a class="path-link" href="${deviceURL(j.deviceId)}" data-device-detail="${escapeHTML(j.deviceId)}">${escapeHTML(j.devicePath)} <span>OPEN ↗</span></a><br><small>${escapeHTML(statusLabel(j.kind))}</small></td><td><span class="status status-${j.status}">${escapeHTML(statusLabel(j.status))}</span>${j.error?`<br><small>${escapeHTML(j.error)}</small>`:""}</td><td><progress class="progress" aria-label="${escapeHTML(statusLabel(j.kind))} progress" max="100" value="${percent.toFixed(1)}">${percent.toFixed(1)}%</progress><small>${percent.toFixed(1)}%</small></td><td>${fmtSpeed(j.readBps)}<br><small>${j.readIops?`${j.readIops.toFixed(1)} IOPS`:""}</small></td><td>${fmtDate(j.createdAt)}</td><td><div class="actions">${actions}</div></td></tr>`
 }).join("")}</tbody></table>`}
function workspaceJobActions(job){
 if(!job||state.user?.role==="viewer")return"";
 const active=["queued","validating","running","pause_requested"].includes(job.status),reportable=["completed","completed_with_warnings","failed","cancelled","interrupted"].includes(job.status);
 let actions="";if(job.status==="running"&&["surface_read","destructive_verify"].includes(job.kind))actions+=`<button class="tonal" data-action="pause" data-id="${job.id}">Pause test</button>`;
 if(["paused","interrupted"].includes(job.status))actions+=`<button class="filled" data-action="resume" data-id="${job.id}">Resume test</button>`;
 if(active||job.status==="paused")actions+=`<button class="text-button" data-action="cancel" data-id="${job.id}">Cancel test</button>`;
 if(reportable)actions+=`<button class="tonal" data-action="report" data-id="${job.id}">Generate PDF</button>`;return actions
}
function surfaceMap(job){
 if(!job)return`<div class="workspace-empty">No surface scan has been run on this drive.</div>`;
 const cells=384,progress=Math.max(0,Math.min(1,job.progress||0)),current=Math.min(cells-1,Math.floor(progress*cells)),bad=new Set(),total=Math.max(1,job.totalBytes||1);
 for(const error of job.errors||[]){const first=Math.max(0,Math.floor((error.offset/total)*cells)),last=Math.min(cells-1,Math.floor(((error.offset+Math.max(1,error.length))/total)*cells));for(let cell=first;cell<=last;cell++)bad.add(cell)}
 const tiles=Array.from({length:cells},(_,index)=>{const type=bad.has(index)?"bad":index>current?"pending":index===current&&progress<1?"current":"good",start=Math.floor((index/cells)*total),end=Math.floor(((index+1)/cells)*total);return`<i class="map-${type}" title="${fmtBytes(start)}–${fmtBytes(end)} · ${type==="bad"?"unreadable":type}"></i>`}).join("");
 return`<div class="map-meta"><span><strong>${(progress*100).toFixed(1)}%</strong> scanned</span><span><strong>${fmtBytes(job.completedBytes)}</strong> of ${fmtBytes(job.totalBytes)}</span><span><strong>${fmtSpeed(job.readBps)}</strong> current rate</span><span><strong>${bad.size}</strong> affected ranges</span><span>${escapeHTML(job.id)}</span></div><div class="drive-map" role="img" aria-label="Full surface scan block map">${tiles}</div><div class="map-legend"><span><i class="map-good"></i>Read successfully</span><span><i class="map-current"></i>Current range</span><span><i class="map-bad"></i>Unreadable</span><span><i class="map-pending"></i>Not scanned</span></div>`
}
function openDeviceWorkspace(id,{updateHistory=true}={}){
 const device=state.devices.find(item=>item.id===id);if(!device)return false;
 selectedDeviceId=id;const jobs=state.jobs.filter(job=>job.deviceId===id);selectedWorkspaceJob=jobs.find(job=>["running","paused","validating"].includes(job.status))?.id||jobs[0]?.id||null;
 renderDeviceWorkspace();const workspace=$("#drive-workspace");if(!workspace.open)workspace.showModal();
 if(updateHistory&&location.pathname!==deviceURL(id))history.pushState({deviceId:id},"",deviceURL(id));
 return true
}
function renderDeviceWorkspace(){
 const device=state.devices.find(item=>item.id===selectedDeviceId);if(!device)return;
 const workspace=$("#drive-workspace"),savedScroll=workspace.scrollTop,focusedId=document.activeElement?.id,probe=device.probe||{},firmwareTest=probe.smartSelfTest,jobs=state.jobs.filter(job=>job.deviceId===device.id);
 const selected=jobs.find(job=>job.id===selectedWorkspaceJob)||jobs.find(job=>["running","paused","validating","queued"].includes(job.status))||jobs[0]||null;selectedWorkspaceJob=selected?.id||null;
 const surface=jobs.find(job=>job.kind==="surface_read"&&["running","paused"].includes(job.status))||jobs.find(job=>job.kind==="surface_read"),history=historyAssessment(probe),percent=Math.max(0,Math.min(100,(selected?.progress||0)*100));
 $("#workspace-title").textContent=probe.model||device.name||device.id;$("#workspace-path").textContent=`${device.path} · ${probe.protocol||"unknown protocol"} · ${fmtBytes(probe.capacityBytes)}`;$("#workspace-status").innerHTML=`<span class="status status-${escapeHTML(device.status)}">${escapeHTML(statusLabel(device.status))}</span>`;
 const smartRows=probe.smartAttributes?.length?probe.smartAttributes.map(attribute=>`<tr><td>${attribute.id}</td><td>${escapeHTML(attribute.name)}</td><td>${attribute.current}</td><td>${attribute.worst}</td><td>${attribute.threshold}</td><td>${escapeHTML(attribute.rawString||attribute.rawValue)}</td><td>${escapeHTML(attribute.whenFailed||"—")}</td></tr>`).join(""):`<tr><td colspan="7">The current device snapshot does not include SMART attributes.</td></tr>`;
 const farmMetrics=flattenFARM(probe.farm),farmRows=farmMetrics.length?farmMetrics.map(([metric,value])=>`<tr><td>${escapeHTML(metric.replaceAll("."," › "))}</td><td>${escapeHTML(value)}</td><td><span class="source-chip">FARM log</span></td></tr>`).join(""):`<tr><td colspan="3">${probe.farmAvailable?"The FARM log was returned without displayable scalar fields.":"FARM is unavailable for this device."}</td></tr>`;
 const historyRows=jobs.length?jobs.map(job=>`<tr><td>${escapeHTML(job.id)}</td><td>${escapeHTML(statusLabel(job.kind))}</td><td><span class="status status-${job.status}">${escapeHTML(statusLabel(job.status))}</span></td><td>${((job.progress||0)*100).toFixed(1)}%</td><td>${escapeHTML(job.currentPhase||job.error||"—")}</td><td>${fmtSpeed(job.readBps)}</td></tr>`).join(""):`<tr><td colspan="6">No tests have been run on this drive.</td></tr>`;
 const selectedPanel=selected?`<div class="live-progress"><div class="progress-ring"><strong>${percent.toFixed(1)}%</strong><span>complete</span><progress class="detail-progress" aria-label="${escapeHTML(statusLabel(selected.kind))} progress" max="100" value="${percent.toFixed(1)}">${percent.toFixed(1)}%</progress></div><div><span class="status status-${selected.status}">${escapeHTML(statusLabel(selected.status))}</span><h3>${escapeHTML(selected.profileName||statusLabel(selected.kind))}</h3><p class="supporting">${escapeHTML(selected.currentPhase||selected.error||"Waiting for worker update")}</p><div class="job-detail-list"><div class="job-detail"><span>Checked</span><strong>${fmtBytes(selected.completedBytes)} / ${fmtBytes(selected.totalBytes)}</strong></div><div class="job-detail"><span>Performance</span><strong>${fmtSpeed(selected.readBps)}</strong></div><div class="job-detail"><span>Sector errors</span><strong>${selected.errors?.length||0}</strong></div></div><div class="workspace-actions">${workspaceJobActions(selected)}</div></div></div>`:`<div class="workspace-empty">No test is associated with this drive.</div>`;
 $("#workspace-content").innerHTML=`<div class="workspace-hero"><section class="workspace-panel"><p class="eyebrow">Drive condition</p><h3>${escapeHTML(probe.model||device.name||device.id)}</h3><p class="supporting">Serial ${escapeHTML(probe.serial||"unavailable")} · firmware ${escapeHTML(probe.firmware||"unavailable")} · collected ${fmtDate(probe.collectedAt)}</p><div class="workspace-overview">${[["SMART health",probe.smartAvailable?(probe.smartPassed?"Passed":"Failed"):"Unavailable"],["Drive interface",probe.deviceInterface||"—"],["Recording type",probe.recordingType||"—"],["Temperature",probe.temperatureC?`${probe.temperatureC} °C`:"—"],["Power-on hours",probe.powerOnHours?.toLocaleString?.()||"—"],["Pending sectors",probe.pendingSectors??"—"],["Reallocated",probe.reallocatedSectors??"—"],["Uncorrectable",probe.uncorrectableSectors??"—"]].map(([label,value])=>`<div class="fact"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${firmwareTest?`<div class="smart-test-banner workspace-smart-test"><span class="status status-running">running</span><div><strong>${escapeHTML(smartSelfTestLabel(firmwareTest))}</strong><small>${escapeHTML(firmwareTest.status||"Detected from drive firmware")}</small></div></div>`:""}</section><section class="workspace-panel"><div class="workspace-section-head"><div><p class="eyebrow">Live progress</p><h3>Selected test</h3></div>${jobs.length>1?`<label class="job-selector">View test<select id="workspace-test-select">${jobs.map(job=>`<option value="${job.id}" ${job.id===selected?.id?"selected":""}>${escapeHTML(job.id)} · ${escapeHTML(statusLabel(job.status))} · ${escapeHTML(statusLabel(job.kind))}</option>`).join("")}</select></label>`:""}</div>${selectedPanel}</section></div><section class="workspace-panel workspace-section"><div class="workspace-section-head"><div><p class="eyebrow">Real-time media view</p><h3>Full sector map</h3></div><span>Mapped from durable byte checkpoints and sector errors</span></div>${surfaceMap(surface)}</section><section class="workspace-section integrity-card ${history.kind}"><h3>${escapeHTML(history.label)}</h3>${history.evidence.map(item=>`<p>• ${escapeHTML(item)}</p>`).join("")}<p><strong>Heuristic only:</strong> conflicting counters can indicate a reset but do not prove intentional wiping.</p></section><section class="workspace-section"><div class="workspace-section-head"><div><p class="eyebrow">Complete device log</p><h3>SMART attribute table</h3></div><span>${probe.smartAttributes?.length||0} attributes · updated ${fmtDate(probe.collectedAt)}</span></div><div class="table-card"><table class="smart-full-table"><thead><tr><th>ID</th><th>Attribute</th><th>Current</th><th>Worst</th><th>Threshold</th><th>Raw value</th><th>Failed</th></tr></thead><tbody>${smartRows}</tbody></table></div></section><section class="workspace-section"><div class="workspace-section-head"><div><p class="eyebrow">Complete device log</p><h3>Seagate FARM table</h3></div><span>${farmMetrics.length} scalar metrics</span></div><div class="table-card"><table class="farm-table"><thead><tr><th>Metric path</th><th>Value</th><th>Source</th></tr></thead><tbody>${farmRows}</tbody></table></div></section><section class="workspace-section"><div class="workspace-section-head"><div><p class="eyebrow">Evidence timeline</p><h3>All tests for this drive</h3></div><span>${jobs.length} retained job${jobs.length===1?"":"s"}</span></div><div class="table-card"><table><thead><tr><th>Job</th><th>Test</th><th>Status</th><th>Progress</th><th>Phase</th><th>Performance</th></tr></thead><tbody>${historyRows}</tbody></table></div></section>`;
 workspace.scrollTop=savedScroll;if(focusedId)document.getElementById(focusedId)?.focus({preventScroll:true})
}
function reportRows(){
 if(!state.reports.length)return`<div class="empty">Generate a PDF from a completed test.</div>`;
 return`<table><thead><tr><th>Report</th><th>Test</th><th>Verdict</th><th>Created</th><th>Integrity</th><th>Download</th></tr></thead><tbody>${state.reports.map(r=>`<tr><td><strong>${escapeHTML(r.id)}</strong></td><td>${escapeHTML(r.jobId)}</td><td><span class="status status-${r.verdict==="pass"?"completed":escapeHTML(r.verdict)}">${escapeHTML(r.verdict)}</span></td><td>${fmtDate(r.createdAt)}</td><td><button data-verify="${r.id}">Verify</button></td><td><a href="/api/v1/reports/${encodeURIComponent(r.id)}/download">PDF</a> · <a href="/api/v1/reports/${encodeURIComponent(r.id)}/checksum">SHA-256</a></td></tr>`).join("")}</tbody></table>`}
function syncSelect(select,html){
 const selected=select.value;
 if(select.innerHTML!==html)select.innerHTML=html;
 if([...select.options].some(option=>option.value===selected))select.value=selected
}
function renderLiveData(){
 $("#devices").innerHTML=state.devices.length?state.devices.map(deviceCard).join(""):`<div class="empty">No physical drives discovered.</div>`;
 $("#jobs").innerHTML=jobRows(state.jobs);$("#recent-jobs").innerHTML=jobRows(state.jobs.slice(0,5));$("#reports").innerHTML=reportRows();
 $("#summary").innerHTML=[["Drives",state.devices.length],["Ready",state.devices.filter(d=>d.status==="ready").length],["Quarantined",state.devices.filter(d=>d.status==="quarantined").length],["Active jobs",state.jobs.filter(j=>["queued","validating","running"].includes(j.status)).length],["Running SMART tests",state.devices.filter(d=>d.probe?.smartSelfTest).length]].map(([l,v])=>`<div class="summary-card"><span>${l}</span><strong>${v}</strong></div>`).join("");
 if(selectedDeviceId&&$("#drive-workspace").open)renderDeviceWorkspace()
}
async function refreshAll(){
 try{
  const [devices,jobs,reports,settings,policies,profiles]=await Promise.all([api("/api/v1/devices"),api("/api/v1/jobs"),api("/api/v1/reports"),api("/api/v1/settings"),api("/api/v1/policies"),api("/api/v1/profiles")]);
  Object.assign(state,{devices:devices.devices,jobs:jobs.jobs,reports:reports.reports,settings,policies:policies.policies,profiles:profiles.profiles});
  syncSelect($("#test-form").elements.profileId,state.profiles.filter(p=>p.enabled).map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}${p.builtIn?"":" · advanced"}</option>`).join(""));
  syncSelect($("#test-form").elements.policyId,state.policies.map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · v${p.version}</option>`).join(""));
	  renderLiveData();
	  $("#daemon-state").textContent="Daemon responsive";$("#daemon-state").className="status status-ready";$("#updated").textContent=`Updated ${new Date().toLocaleTimeString()}`;
	  if(state.user.role==="admin")await refreshAdmin();
 }catch(error){$("#daemon-state").textContent="Connection lost";$("#daemon-state").className="status status-quarantined";notify(error.message,true)}
}
async function refreshLive(){
 if(liveRefreshInFlight)return;liveRefreshInFlight=true;
 try{
  const [devices,jobs,reports]=await Promise.all([api("/api/v1/devices"),api("/api/v1/jobs"),api("/api/v1/reports")]);
  const changed=JSON.stringify([state.devices,state.jobs,state.reports])!==JSON.stringify([devices.devices,jobs.jobs,reports.reports]);
  Object.assign(state,{devices:devices.devices,jobs:jobs.jobs,reports:reports.reports});
  if(changed)renderLiveData();
  $("#daemon-state").textContent="Daemon responsive";$("#daemon-state").className="status status-ready";$("#updated").textContent=`Updated ${new Date().toLocaleTimeString()}`
 }catch(error){$("#daemon-state").textContent="Connection lost";$("#daemon-state").className="status status-quarantined";notify(error.message,true)}finally{liveRefreshInFlight=false}
}
async function refreshAdmin(){
 const [users,audit]=await Promise.all([api("/api/v1/users"),api("/api/v1/audit")]);
 const f=$("#settings-form"),s=state.settings;for(const name of["organization","maxConcurrentJobs","maxDestructiveJobs","jobChunkMiB","retentionDays","retentionMaxBytes"])f.elements[name].value=s[name];f.elements.destructiveEnabled.checked=s.destructiveEnabled;
 $("#users-list").innerHTML=users.users.map(u=>`<div class="user-row"><span>${escapeHTML(u.username)}</span><small>${escapeHTML(u.role)}</small></div>`).join("");
 $("#audit").innerHTML=`<table><thead><tr><th>Time</th><th>Action</th><th>User</th><th>Target</th></tr></thead><tbody>${audit.events.map(e=>`<tr><td>${fmtDate(e.at)}</td><td>${escapeHTML(e.action)}</td><td>${escapeHTML(e.userId||"system")}</td><td>${escapeHTML(e.target||"—")}</td></tr>`).join("")}</tbody></table>`;
}
async function refreshDevices(){try{await api("/api/v1/discovery/refresh",{method:"POST"});notify("Drive discovery started");setTimeout(refreshAll,1000)}catch(e){notify(e.message,true)}}
$("#refresh-devices")?.addEventListener("click",refreshDevices);
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
document.addEventListener("click",e=>{const detail=e.target.closest("[data-device-detail]");if(!detail)return;e.preventDefault();openDeviceWorkspace(detail.dataset.deviceDetail)});
$("#workspace-content").addEventListener("click",jobClick);
$("#workspace-content").addEventListener("change",e=>{if(e.target.id==="workspace-test-select"){selectedWorkspaceJob=e.target.value;renderDeviceWorkspace()}});
$$("[data-close-workspace]").forEach(button=>button.addEventListener("click",()=>$("#drive-workspace").close()));
$("#drive-workspace").addEventListener("close",()=>{selectedDeviceId=null;selectedWorkspaceJob=null;if(deviceIDFromURL())history.pushState({},"","/")});
window.addEventListener("popstate",()=>{const id=deviceIDFromURL(),workspace=$("#drive-workspace");if(id)openDeviceWorkspace(id,{updateHistory:false});else if(workspace.open)workspace.close()});
$("#reports").addEventListener("click",async e=>{const b=e.target.closest("[data-verify]");if(!b)return;try{const v=await api(`/api/v1/reports/${b.dataset.verify}/verify`);notify(v.valid?"PDF checksum is valid":"PDF has been modified",!v.valid)}catch(error){notify(error.message,true)}});
$("#settings-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),old=state.settings,body={...old,organization:f.get("organization"),maxConcurrentJobs:Number(f.get("maxConcurrentJobs")),maxDestructiveJobs:Number(f.get("maxDestructiveJobs")),jobChunkMiB:Number(f.get("jobChunkMiB")),retentionDays:Number(f.get("retentionDays")),retentionMaxBytes:Number(f.get("retentionMaxBytes")),destructiveEnabled:f.get("destructiveEnabled")==="on"};try{await api("/api/v1/settings",{method:"PUT",body:JSON.stringify(body)});notify("Settings saved");await refreshAll()}catch(error){notify(error.message,true)}});
$("#user-form").addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/v1/users",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("User created");await refreshAdmin()}catch(error){notify(error.message,true)}});
$("#password-form").addEventListener("submit",async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api("/api/v1/auth/password",{method:"POST",body:JSON.stringify(body)});showLogin();notify("Password changed. Sign in again.")}catch(error){notify(error.message,true)}});
$("#profile-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get("name"),kind:f.get("kind"),blockSizeKiB:Number(f.get("blockSizeKiB")),queueDepth:Number(f.get("queueDepth")),durationSeconds:Number(f.get("durationSeconds")),rateMiB:Number(f.get("rateMiB"))};try{await api("/api/v1/profiles",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("Advanced profile created");await refreshAll()}catch(error){notify(error.message,true)}});
$("#policy-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get("name"),failOnSmart:f.get("failOnSmart")==="on",failOnIoError:f.get("failOnIoError")==="on",warnPendingAbove:Number(f.get("warnPendingAbove")),warnReallocatedAbove:Number(f.get("warnReallocatedAbove")),warnUncorrectableAbove:Number(f.get("warnUncorrectableAbove"))};try{await api("/api/v1/policies",{method:"POST",body:JSON.stringify(body)});e.currentTarget.reset();notify("Grading policy created");await refreshAll()}catch(error){notify(error.message,true)}});
(async()=>{let user;try{user=await api("/api/v1/auth/session")}catch{showLogin();return}showApp(user);await refreshAll();const id=deviceIDFromURL();if(id&&!openDeviceWorkspace(id,{updateHistory:false}))notify("Drive is no longer available",true)})();
setInterval(()=>{if(state.user)refreshLive()},3000);
