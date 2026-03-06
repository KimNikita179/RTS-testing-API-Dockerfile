// simple hash-based router
window.addEventListener("hashchange", router);
window.addEventListener("load", router);

function router() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("run/")) {
    const id = hash.split("/")[1];
    showRun(id);
  } else if (hash === "builder") {
    showBuilder();
  } else {
    showRuns();
  }
}

async function showRuns() {
  const content = document.getElementById("content");
  content.innerHTML =
    '<div class="container page-shell"><div class="page-header"><h2>📊 All Runs</h2><p>View and manage test execution history</p></div><p class="surface-card">Loading...</p></div>';
  try {
    const res = await fetch("/runs");
    const runs = await res.json();
    if (!Array.isArray(runs)) {
      content.innerHTML = "<div class='container page-shell'><p class='surface-card'>Unexpected response format</p></div>";
      return;
    }
    let html = '<div class="container page-shell">';
    html += '<div class="page-header"><h2>📊 All Runs</h2><p>View and manage test execution history</p></div>';
    
    if (runs.length === 0) {
      html += '<div class="surface-card"><p style="text-align: center; color: var(--muted); font-size: 1.1rem;">No test runs yet. <a href="#builder">Create one</a></p></div>';
    } else {
      html += '<div class="surface-card"><table class="runs-table"><thead><tr><th>🆔 Run ID</th><th>⚙️ Status</th><th>📅 Created</th></tr></thead><tbody>';
      runs.forEach((r) => {
        const statusClass = `status-${r.status.toLowerCase()}`;
        html += `<tr><td><a href="#run/${r.runId}" class="run-link">${r.runId}</a></td><td><span class="status-badge ${statusClass}">${r.status}</span></td><td>${new Date(r.createdAt).toLocaleString()}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    html += "</div>";
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="container page-shell"><div class="surface-card"><p style="color: var(--danger);">Error: ${e.message}</p></div></div>`;
  }
}

async function showRun(id) {
  const content = document.getElementById("content");
  content.innerHTML = `<div class="container page-shell"><div class="page-header"><h2>🔍 Run Details</h2><p>Loading...</p></div></div>`;
  
  let testConfig = null; // Store config for restart
  
  try {
    const res = await fetch(`/runs/${id}`);
    if (!res.ok) {
      content.innerHTML = `<div class="container page-shell"><div class="surface-card"><p style="color: var(--danger);">Run not found</p></div></div>`;
      return;
    }
    const r = await res.json();
    testConfig = r; // Save for restart
    
    const statusClass = `status-${r.status.toLowerCase()}`;
    let html = `<div class="container page-shell">`;
    
    html += `<div class="page-header">
      <div style="flex: 1;">
        <h2>🔍 Run ${r.runId.slice(0, 8)}...</h2>
        <p><span class="status-badge ${statusClass}">${r.status.toUpperCase()}</span></p>
      </div>
      <div style="display: flex; gap: 10px;">
        <button id="restartBtn" class="btn" style="margin: 0;">🔄 Restart</button>
        <button id="backToRunsBtn" class="btn" style="margin: 0;">← Back</button>
      </div>
    </div>`;
    
    if (r.status === "running" || r.status === "queued") {
      html += `<div class="surface-card">
        <div class="section-title">⏳ Current Progress</div>
        <div class="current-box">${JSON.stringify(r.current, null, 2)}</div>
      </div>`;
    }
    
    if (r.results && r.results.length) {
      html += `<div class="surface-card">
        <div class="section-title">📋 Test Results</div>`;
      r.results.forEach((test) => {
        const testStatus = test.ok ? '✓' : '✗';
        const testStatusClass = test.ok ? 'success' : 'error';
        html += `<div class="test-card surface-card" style="margin-bottom: 16px; border-left: 4px solid ${test.ok ? 'var(--success)' : 'var(--danger)'};">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div style="flex: 1;">
              <h3 class="test-title"><span style="color: ${test.ok ? 'var(--success)' : 'var(--danger)'}">${testStatus}</span> Test ${test.id}: ${test.name}</h3>
              <div style="font-size: 0.85rem; color: var(--muted); margin-top: 8px;">Type: <strong>${test.type}</strong></div>
            </div>
          </div>
          <div class="step-list" style="margin-top: 16px;">`;
        
        test.steps.forEach((step, stepIdx) => {
          const stepStatus = step.ok ? '✓' : '✗';
          const stepStatusColor = step.ok ? 'var(--success)' : 'var(--danger)';
          
          // Calculate duration
          let duration = 'N/A';
          if (step.startedAt && step.finishedAt) {
            const start = new Date(step.startedAt);
            const finish = new Date(step.finishedAt);
            duration = `${(finish - start).toFixed(0)}ms`;
          }
          
          html += `<div class="step" style="border-left: 3px solid ${stepStatusColor};">
            <div class="step-main">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: ${stepStatusColor}; font-weight: bold; font-size: 1.1rem;">${stepStatus}</span>
                <strong>${step.action}</strong>
                <span class="step-id">#${step.id}</span>
              </div>
              <div style="display: flex; gap: 12px; align-items: center;">
                <span style="background: rgba(0, 95, 115, 0.1); padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; color: #0c5468;">⏱️ ${duration}</span>
              </div>
            </div>`;
            
            if (step.startedAt && step.finishedAt) {
              const startTime = new Date(step.startedAt).toLocaleTimeString();
              html += `<div class="step-meta">Started: ${startTime}</div>`;
            }
            
            if (step.ok !== undefined) {
              html += `<div class="step-meta">Status: <strong style="color: ${step.ok ? 'var(--success)' : 'var(--danger)'}">${step.ok ? '✓ PASS' : '✗ FAIL'}</strong></div>`;
            }
            
            if (step.error) {
              html += `<div class="step-error">⚠️ Error: ${step.error}</div>`;
            }
            
            if (step.screenshotUrl) {
              html += `<img src="${step.screenshotUrl}" alt="Step screenshot" style="margin-top: 12px; border-radius: 8px; max-width: 100%; border: 1px solid rgba(0,0,0,0.1);">`;
            }
            
            html += `</div>`;
        });
        
        html += `</div></div>`;
      });
      html += `</div>`;
    }
    
    html += `</div>`;
    content.innerHTML = html;
    
    // Add event listeners for buttons
    const restartBtn = document.getElementById("restartBtn");
    const backBtn = document.getElementById("backToRunsBtn");
    
    if (restartBtn) {
      restartBtn.addEventListener("click", () => {
        if (!testConfig) return;
        
        // Prepare config for restart - remove result data, keep defaults
        const restartConfig = {
          specVersion: testConfig.specVersion || "1.0",
          project: testConfig.project,
          defaults: testConfig.defaults,
          variables: testConfig.variables || {},
          tests: testConfig.tests || []
        };
        
        restartBtn.disabled = true;
        restartBtn.textContent = "⏳ Restarting...";
        
        fetch("/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(restartConfig)
        })
        .then(res => res.json())
        .then(data => {
          if (data.runId) {
            location.hash = `#run/${data.runId}`;
          } else {
            alert("Error restarting test: " + (data.detail || "Unknown error"));
            restartBtn.disabled = false;
            restartBtn.textContent = "🔄 Restart";
          }
        })
        .catch(err => {
          alert("Error: " + err.message);
          restartBtn.disabled = false;
          restartBtn.textContent = "🔄 Restart";
        });
      });
    }
    
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        location.hash = "#runs";
      });
    }
    
  } catch (e) {
    content.innerHTML = `<div class="container page-shell"><div class="surface-card"><p style="color: var(--danger);">Error: ${e.message}</p></div></div>`;
  }
}

function showBuilder() {
  const content = document.getElementById("content");
  content.innerHTML = `<div class="container page-shell">
    <div class="page-header">
      <h2>🛠️ Test Builder</h2>
      <p>Graphical test constructor with full API support</p>
    </div>
    <div id="mainBuilder"></div>
  </div>`;
  
  setTimeout(() => initMaterialComponents(), 0);

  const state = {
    specVersion: "1.0",
    project: "",
    defaults: {
      baseUrl: "",
      timeoutsMs: { step: 15000, navigation: 30000 },
      ui: { browser: "chromium", viewport: { width: 1280, height: 720 } }
    },
    variables: {},
    tests: [],
    currentTestIndex: -1,
    currentStepIndex: -1,
  };

  const mainBuilder = document.getElementById("mainBuilder");
  let currentView = "suite"; // suite | test-edit | step-edit

  function initMaterialComponents() {
    const selects = document.querySelectorAll("select");
    selects.forEach(s => M.FormSelect.init(s));
    M.updateTextFields();
    const textareas = document.querySelectorAll("textarea");
    textareas.forEach(ta => M.textareaAutoResize(ta));
  }

  function saveJSON() {
    const json = JSON.stringify(state, null, 2);
    localStorage.setItem("builderState", json);
  }

  function updateJSON() {
    const json = JSON.stringify(state, null, 2);
    const jsonArea = document.getElementById("jsonOutput");
    if (jsonArea) jsonArea.value = json;
  }

  function renderSuiteView() {
    currentView = "suite";
    let html = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div>
          <div class="surface-card">
            <div class="section-title">⚙️ Suite Configuration</div>
            
            <div class="input-field">
              <input id="project" type="text" value="${state.project}">
              <label for="project" class="active">Project Name</label>
            </div>
            
            <div class="input-field">
              <input id="baseUrl" type="text" value="${state.defaults.baseUrl}">
              <label for="baseUrl" class="active">Base URL</label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="input-field">
                <input id="stepTimeout" type="number" value="${state.defaults.timeoutsMs.step}">
                <label for="stepTimeout" class="active">Step Timeout (ms)</label>
              </div>
              <div class="input-field">
                <input id="navTimeout" type="number" value="${state.defaults.timeoutsMs.navigation}">
                <label for="navTimeout" class="active">Navigation Timeout (ms)</label>
              </div>
            </div>
            
            <div class="input-field">
              <select id="browser">
                <option value="chromium" ${state.defaults.ui.browser === 'chromium' ? 'selected' : ''}>Chromium</option>
                <option value="firefox" ${state.defaults.ui.browser === 'firefox' ? 'selected' : ''}>Firefox</option>
                <option value="webkit" ${state.defaults.ui.browser === 'webkit' ? 'selected' : ''}>WebKit</option>
              </select>
              <label>Browser</label>
            </div>
            
            <hr style="margin: 20px 0;">
            
            <div class="section-title">📦 Variables</div>
            <div id="varsList"></div>
            <button id="addVarBtn" class="btn" style="margin-top: 10px;">+ Add Variable</button>
          </div>
        </div>
        
        <div>
          <div class="surface-card">
            <div class="section-title">📝 Tests (${state.tests.length})</div>
            <div id="testsList" style="margin-bottom: 15px;"></div>
            <button id="addTestBtn" class="btn waves-effect waves-light" style="width: 100%; margin-bottom: 15px;">+ Create Test</button>
            
            <hr>
            
            <div class="section-title">📋 JSON Preview</div>
            <textarea id="jsonOutput" class="materialize-textarea" style="min-height: 350px; font-size: 0.75rem;"></textarea>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">
              <button id="downloadBtn" class="btn" style="width: 100%;">💾 Download</button>
              <button id="exportBtn" class="btn" style="width: 100%;">📤 Run Tests</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    mainBuilder.innerHTML = html;
    renderVariablesList();
    renderTestsList();
    updateJSON();
    initMaterialComponents();
  }

  function renderVariablesList() {
    const varsList = document.getElementById("varsList");
    if (!varsList) return;
    
    let html = '<div class="step-list" style="max-height: 200px; overflow-y: auto;">';
    Object.entries(state.variables).forEach(([key, value]) => {
      html += `<div class="step" style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${key}</strong>: <code>${value}</code>
        </div>
        <button class="btn-small delete-var" data-key="${key}" style="padding: 4px 8px; font-size: 0.8rem;">✕</button>
      </div>`;
    });
    html += '</div>';
    varsList.innerHTML = html;
  }

  function renderTestsList() {
    const testsList = document.getElementById("testsList");
    if (!testsList) return;
    
    let html = '<div class="step-list">';
    state.tests.forEach((t, idx) => {
      const isSelected = idx === state.currentTestIndex;
      html += `<div class="step" style="cursor: pointer; ${isSelected ? 'background: rgba(10, 147, 150, 0.1); border-left: 4px solid #0a9396;' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1; cursor: pointer;" class="test-select" data-idx="${idx}">
            <strong>${t.id || `Test ${idx + 1}`}</strong>
            <div style="font-size: 0.8rem; color: var(--muted);">${t.type} • ${t.steps.length} steps</div>
          </div>
          <button class="btn-small delete-test" data-idx="${idx}" style="padding: 4px 8px; font-size: 0.8rem;">🗑️</button>
        </div>
      </div>`;
    });
    html += '</div>';
    testsList.innerHTML = html;
  }

  function renderTestEditView() {
    currentView = "test-edit";
    if (state.currentTestIndex < 0) return renderSuiteView();
    
    const t = state.tests[state.currentTestIndex];
    let html = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div>
          <div class="surface-card">
            <button id="backBtn" class="btn" style="margin-bottom: 15px;">← Back to Suite</button>
            <div class="section-title">✏️ Test ${state.currentTestIndex + 1}</div>
            
            <div class="input-field">
              <input id="testId" type="text" value="${t.id || ''}">
              <label for="testId" class="active">Test ID</label>
            </div>
            
            <div class="input-field">
              <input id="testName" type="text" value="${t.name || ''}">
              <label for="testName" class="active">Test Name</label>
            </div>
            
            <div class="input-field">
              <select id="testType">
                <option value="ui" ${t.type === 'ui' ? 'selected' : ''}>UI Test</option>
                <option value="api" ${t.type === 'api' ? 'selected' : ''}>API Test</option>
              </select>
              <label>Test Type</label>
            </div>
            
            ${t.type === 'ui' ? `
              <div class="input-field">
                <input id="startUrl" type="text" value="${t.startUrl || ''}">
                <label for="startUrl" class="active">Start URL (optional)</label>
              </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="input-field">
                <input id="testTags" type="text" value="${(t.tags || []).join(', ')}">
                <label for="testTags" class="active">Tags (comma-separated)</label>
              </div>
              <div class="input-field">
                <input id="testSeverity" type="text" value="${t.severity || 'normal'}">
                <label for="testSeverity" class="active">Severity</label>
              </div>
            </div>
          </div>
        </div>
        
        <div>
          <div class="surface-card">
            <div class="section-title">📋 Steps (${t.steps.length})</div>
            <div id="stepsList" style="margin-bottom: 15px;"></div>
            <button id="addStepBtn" class="btn waves-effect waves-light" style="width: 100%;">+ Add Step</button>
          </div>
        </div>
      </div>
    `;
    
    mainBuilder.innerHTML = html;
    renderStepsList();
    initMaterialComponents();
  }

  function renderStepsList() {
    const stepsList = document.getElementById("stepsList");
    if (!stepsList) return;
    
    const t = state.tests[state.currentTestIndex];
    let html = '<div class="step-list" style="max-height: 500px; overflow-y: auto;">';
    
    t.steps.forEach((s, idx) => {
      const isSelected = idx === state.currentStepIndex;
      const actionIcon = getActionIcon(s.action);
      html += `<div class="step" draggable="true" data-step-idx="${idx}" style="cursor: move; ${isSelected ? 'background: rgba(10, 147, 150, 0.1); border-left: 4px solid #0a9396;' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1; cursor: pointer;" class="step-select" data-idx="${idx}">
            <div><strong>☰ ${actionIcon} ${s.action}</strong></div>
            <div style="font-size: 0.75rem; color: var(--muted);">${s.id}</div>
          </div>
          <button class="btn-small delete-step" data-idx="${idx}" style="padding: 4px 8px; font-size: 0.8rem;">🗑️</button>
        </div>
      </div>`;
    });
    
    html += '</div>';
    stepsList.innerHTML = html;
    
    // Setup drag-and-drop
    setupStepsDragDrop();
  }

  function setupStepsDragDrop() {
    const steps = document.querySelectorAll('[data-step-idx]');
    let draggedElement = null;
    let draggedIndex = null;

    steps.forEach(step => {
      step.addEventListener('dragstart', (e) => {
        draggedElement = step;
        draggedIndex = parseInt(step.dataset.stepIdx);
        step.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
      });

      step.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const rect = step.getBoundingClientRect();
        const afterMidpoint = e.clientY > (rect.top + rect.height / 2);
        
        if (draggedElement !== step) {
          if (afterMidpoint) {
            step.parentNode.insertBefore(draggedElement, step.nextSibling);
          } else {
            step.parentNode.insertBefore(draggedElement, step);
          }
        }
      });

      step.addEventListener('dragend', (e) => {
        step.style.opacity = '1';
        
        // Reorder steps in state based on new DOM order
        const stepsContainer = document.querySelector('.step-list');
        const stepsInOrder = Array.from(stepsContainer.querySelectorAll('[data-step-idx]'));
        const newOrder = stepsInOrder.map(el => parseInt(el.dataset.stepIdx));
        
        const t = state.tests[state.currentTestIndex];
        const reorderedSteps = newOrder.map(idx => t.steps[idx]);
        t.steps = reorderedSteps;
        
        // Update the IDs to reflect new order
        t.steps.forEach((step, idx) => {
          step.id = `s${idx + 1}`;
        });
        
        saveJSON();
        updateJSON();
      });
    });
  }

  function renderStepEditView() {
    currentView = "step-edit";
    if (state.currentTestIndex < 0 || state.currentStepIndex < 0) return renderTestEditView();
    
    const t = state.tests[state.currentTestIndex];
    const s = t.steps[state.currentStepIndex];
    
    let html = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div>
          <div class="surface-card">
            <button id="backBtn" class="btn" style="margin-bottom: 15px;">← Back to Test</button>
            <div class="section-title">🔧 Step ${state.currentStepIndex + 1}</div>
            
            <div class="input-field">
              <input id="stepId" type="text" value="${s.id || ''}">
              <label for="stepId" class="active">Step ID</label>
            </div>
            
            <div class="input-field">
              <select id="stepAction">
                ${getActionOptions(t.type).map(a => `<option value="${a}" ${s.action === a ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
              <label>Action</label>
            </div>
            
            ${renderStepFields(s, t.type)}
            
            <hr style="margin: 15px 0;">
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <label style="margin-top: 10px;">
                <input type="checkbox" id="continueOnFail" ${s.continueOnFail ? 'checked' : ''}>
                <span style="margin-left: 8px;">Continue on Fail</span>
              </label>
            </div>
            
            <div class="input-field" style="margin-top: 15px;">
              <input id="stepTimeout" type="number" value="${s.timeoutMs || 15000}">
              <label for="stepTimeout" class="active">Timeout (ms)</label>
            </div>
          </div>
        </div>
        
        <div>
          <div class="surface-card">
            <div class="section-title">📊 Step Preview</div>
            <pre style="background: #f0fbfd; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 0.75rem;">
${JSON.stringify(s, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    `;
    
    mainBuilder.innerHTML = html;
    initMaterialComponents();
  }

  function getActionOptions(testType) {
    const uiActions = ['navigate', 'click', 'fill', 'press', 'select', 'hover', 'scrollIntoView', 'waitFor', 'screenshot', 'assert', 'setVar'];
    const apiActions = ['request', 'assert', 'extract'];
    return testType === 'ui' ? uiActions : apiActions;
  }

  function getActionIcon(action) {
    const icons = {
      navigate: '🔗', click: '🖱️', fill: '⌨️', press: '⌨️', select: '📋',
      hover: '🖱️', scrollIntoView: '📖', waitFor: '⏳', screenshot: '📸',
      assert: '✅', setVar: '💾', request: '📤', extract: '🎯'
    };
    return icons[action] || '📌';
  }

  function renderStepFields(s, testType) {
    const action = s.action;
    let html = '';
    
    if (['click', 'fill', 'press', 'select', 'hover', 'scrollIntoView', 'waitFor', 'screenshot', 'assert'].includes(action) && testType === 'ui') {
      if (action !== 'waitFor' || (s.value && typeof s.value !== 'number' && isNaN(s.value))) {
        html += `
          <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
            <div class="section-title">🎯 Target Locator</div>
            <div class="input-field">
              <select id="locatorUsing">
                <option value="css" ${(s.target?.using || 'css') === 'css' ? 'selected' : ''}>CSS Selector</option>
                <option value="xpath" ${(s.target?.using || 'css') === 'xpath' ? 'selected' : ''}>XPath</option>
                <option value="text" ${(s.target?.using || 'css') === 'text' ? 'selected' : ''}>Text Content</option>
                <option value="testId" ${(s.target?.using || 'css') === 'testId' ? 'selected' : ''}>Test ID</option>
              </select>
              <label>Locator Type</label>
            </div>
            <div class="input-field">
              <input id="locatorValue" type="text" value="${s.target?.value || ''}">
              <label for="locatorValue" class="active">Locator Value</label>
            </div>
          </div>
        `;
      }
    }
    
    if (['fill', 'press', 'select', 'navigate', 'setVar'].includes(action)) {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">📝 Value / Input</div>
          <div class="input-field">
            <textarea id="stepValue" class="materialize-textarea">${s.value || ''}</textarea>
            <label for="stepValue" class="active">Value (supports \${varName} substitution)</label>
          </div>
        </div>
      `;
    }
    
    if (action === 'waitFor' && s.value && typeof s.value === 'number') {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">⏳ Wait Time</div>
          <div class="input-field">
            <input id="stepValue" type="number" value="${s.value || 5000}">
            <label for="stepValue" class="active">Wait Time (ms)</label>
          </div>
        </div>
      `;
    }
    
    if (action === 'request') {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">📤 Request Config</div>
          <div class="input-field">
            <select id="requestMethod">
              <option value="GET" ${s.value?.method === 'GET' ? 'selected' : ''}>GET</option>
              <option value="POST" ${s.value?.method === 'POST' ? 'selected' : ''}>POST</option>
              <option value="PUT" ${s.value?.method === 'PUT' ? 'selected' : ''}>PUT</option>
              <option value="DELETE" ${s.value?.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
              <option value="PATCH" ${s.value?.method === 'PATCH' ? 'selected' : ''}>PATCH</option>
            </select>
            <label>Method</label>
          </div>
          <div class="input-field">
            <input id="requestUrl" type="text" value="${s.value?.url || ''}">
            <label for="requestUrl" class="active">URL / Path</label>
          </div>
          <div class="input-field">
            <textarea id="requestHeaders" class="materialize-textarea" placeholder='{"Authorization": "Bearer token"}'>${s.value?.headers ? JSON.stringify(s.value.headers, null, 2) : ''}</textarea>
            <label for="requestHeaders" class="active">Headers (JSON)</label>
          </div>
          <div class="input-field">
            <textarea id="requestBody" class="materialize-textarea" placeholder='{"key": "value"}'>${s.value?.body ? JSON.stringify(s.value.body, null, 2) : ''}</textarea>
            <label for="requestBody" class="active">Body (JSON, optional)</label>
          </div>
        </div>
      `;
    }
    
    if (action === 'assert') {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">✅ Assertion</div>
          <div class="input-field">
            <select id="assertKind">
              ${testType === 'ui' 
                ? `<option value="urlContains">URL Contains</option>
                   <option value="locator">Locator Assertion</option>` 
                : `<option value="status">Status Code</option>
                   <option value="jsonPathEquals">JSON Path Equals</option>`}
            </select>
            <label>Assertion Type</label>
          </div>
          <div class="input-field">
            <input id="assertValue" type="text" value="${s.expect?.value || ''}">
            <label for="assertValue" class="active">Expected Value</label>
          </div>
        </div>
      `;
    }
    
    if (action === 'extract') {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">🎯 Extract Value</div>
          <div class="input-field">
            <input id="extractFrom" type="text" value="${s.value?.from || ''}">
            <label for="extractFrom" class="active">From Variable (e.g., \${respVar})</label>
          </div>
          <div class="input-field">
            <input id="extractPath" type="text" value="${s.value?.path || ''}">
            <label for="extractPath" class="active">JSON Path (e.g., $.status.ok)</label>
          </div>
        </div>
      `;
    }
    
    if (['setVar', 'request', 'extract'].includes(action)) {
      html += `
        <div style="border-top: 1px solid rgba(0,0,0,0.1); padding-top: 15px; margin-top: 15px;">
          <div class="section-title">💾 Save As</div>
          <div class="input-field">
            <input id="saveAs" type="text" value="${s.saveAs || ''}">
            <label for="saveAs" class="active">Variable Name</label>
          </div>
        </div>
      `;
    }
    
    return html;
  }

  // Event listeners
  mainBuilder.addEventListener("click", (e) => {
    if (e.target.id === "addTestBtn") {
      state.tests.push({
        id: `test-${state.tests.length + 1}`,
        name: `Test ${state.tests.length + 1}`,
        type: "ui",
        steps: []
      });
      state.currentTestIndex = state.tests.length - 1;
      state.currentStepIndex = -1;
      renderTestEditView();
    }
    
    if (e.target.id === "addStepBtn") {
      state.tests[state.currentTestIndex].steps.push({
        id: `s${state.tests[state.currentTestIndex].steps.length + 1}`,
        action: "navigate",
        target: null,
        value: null,
        saveAs: null,
        timeoutMs: state.defaults.timeoutsMs.step,
        continueOnFail: false
      });
      state.currentStepIndex = state.tests[state.currentTestIndex].steps.length - 1;
      renderStepEditView();
    }
    
    if (e.target.id === "addVarBtn") {
      const key = prompt("Variable name:");
      if (key) {
        const value = prompt("Variable value:");
        if (value) state.variables[key] = value;
        renderSuiteView();
      }
    }
    
    if (e.target.classList.contains("test-select")) {
      state.currentTestIndex = parseInt(e.target.closest(".test-select").dataset.idx);
      state.currentStepIndex = -1;
      renderTestEditView();
    }
    
    if (e.target.classList.contains("step-select")) {
      state.currentStepIndex = parseInt(e.target.closest(".step-select").dataset.idx);
      renderStepEditView();
    }
    
    if (e.target.classList.contains("delete-test")) {
      const idx = parseInt(e.target.dataset.idx);
      state.tests.splice(idx, 1);
      state.currentTestIndex = -1;
      renderSuiteView();
    }
    
    if (e.target.classList.contains("delete-step")) {
      const idx = parseInt(e.target.dataset.idx);
      state.tests[state.currentTestIndex].steps.splice(idx, 1);
      state.currentStepIndex = -1;
      renderStepsList();
    }
    
    if (e.target.classList.contains("delete-var")) {
      delete state.variables[e.target.dataset.key];
      renderVariablesList();
    }
    
    if (e.target.id === "backBtn") {
      if (currentView === "step-edit") {
        state.currentStepIndex = -1;
        renderTestEditView();
      } else {
        state.currentTestIndex = -1;
        renderSuiteView();
      }
    }
    
    if (e.target.id === "downloadBtn") {
      const json = JSON.stringify(state, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${state.project || 'test-suite'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    
    if (e.target.id === "exportBtn") {
      runTests();
    }
  });

  mainBuilder.addEventListener("change", (e) => {
    if (e.target.id === "project") state.project = e.target.value;
    if (e.target.id === "baseUrl") state.defaults.baseUrl = e.target.value;
    if (e.target.id === "stepTimeout") state.defaults.timeoutsMs.step = parseInt(e.target.value);
    if (e.target.id === "navTimeout") state.defaults.timeoutsMs.navigation = parseInt(e.target.value);
    if (e.target.id === "browser") state.defaults.ui.browser = e.target.value;
    
    if (state.currentTestIndex >= 0) {
      const t = state.tests[state.currentTestIndex];
      if (e.target.id === "testId") t.id = e.target.value;
      if (e.target.id === "testName") t.name = e.target.value;
      if (e.target.id === "testType") t.type = e.target.value;
      if (e.target.id === "startUrl") t.startUrl = e.target.value;
      if (e.target.id === "testTags") t.tags = e.target.value.split(",").map(s => s.trim()).filter(s => s);
      if (e.target.id === "testSeverity") t.severity = e.target.value;
    }
    
    if (state.currentStepIndex >= 0 && state.currentTestIndex >= 0) {
      const s = state.tests[state.currentTestIndex].steps[state.currentStepIndex];
      
      if (e.target.id === "stepId") s.id = e.target.value;
      if (e.target.id === "stepAction") {
        s.action = e.target.value;
        s.target = null;
        s.value = null;
        renderStepEditView();
      }
      if (e.target.id === "continueOnFail") s.continueOnFail = e.target.checked;
      if (e.target.id === "stepTimeout") s.timeoutMs = parseInt(e.target.value);
      
      if (e.target.id === "locatorUsing") {
        if (!s.target) s.target = { using: "", value: "" };
        s.target.using = e.target.value;
      }
      if (e.target.id === "locatorValue") {
        if (!s.target) s.target = { using: "css", value: "" };
        s.target.value = e.target.value;
      }
      if (e.target.id === "stepValue") s.value = s.action === 'waitFor' ? parseInt(e.target.value) : e.target.value;
      if (e.target.id === "requestMethod") {
        if (!s.value) s.value = { method: "GET", url: "" };
        s.value.method = e.target.value;
      }
      if (e.target.id === "requestUrl") {
        if (!s.value) s.value = { method: "GET", url: "" };
        s.value.url = e.target.value;
      }
      if (e.target.id === "requestHeaders") {
        if (!s.value) s.value = { method: "GET", url: "" };
        try {
          s.value.headers = JSON.parse(e.target.value || "{}");
        } catch {}
      }
      if (e.target.id === "requestBody") {
        if (!s.value) s.value = { method: "GET", url: "" };
        try {
          s.value.body = JSON.parse(e.target.value || "{}");
        } catch {}
      }
      if (e.target.id === "saveAs") s.saveAs = e.target.value;
      if (e.target.id === "assertKind") {
        if (!s.expect) s.expect = { kind: "", value: "" };
        s.expect.kind = e.target.value;
      }
      if (e.target.id === "assertValue") {
        if (!s.expect) s.expect = { kind: "urlContains", value: "" };
        s.expect.value = e.target.value;
      }
      if (e.target.id === "extractFrom") {
        if (!s.value) s.value = { from: "", path: "" };
        s.value.from = e.target.value;
      }
      if (e.target.id === "extractPath") {
        if (!s.value) s.value = { from: "", path: "" };
        s.value.path = e.target.value;
      }
    }
    
    saveJSON();
    updateJSON();
  });

  function runTests() {
    const json = JSON.stringify(state, null, 2);
    fetch("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json
    })
    .then(res => res.json())
    .then(data => {
      if (data.runId) {
        location.hash = `#run/${data.runId}`;
      }
    })
    .catch(err => alert("Error: " + err.message));
  }

  // Load saved state
  try {
    const saved = localStorage.getItem("builderState");
    if (saved) Object.assign(state, JSON.parse(saved));
  } catch {}

  renderSuiteView();
}
