// Render the authored side panel in an isolated Electron window with a fixture
// chrome API. No user's browser/profile or live webpage is accessed.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, unlinkSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const timer = setTimeout(() => { console.error('Panel verification exceeded 40 seconds.'); app.exit(1) }, 40000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 440, height: 1150, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const fixture = { overview: 'Thiel weighs the risks of AI against the political risks of stagnation. He argues that slowing progress is itself a consequential choice, rather than a neutral baseline.',
    takeaways: [{ text: 'Thiel argues that stagnation can destabilize society when younger generations lose the expectation of a better future.', sources: [1] },
      { text: 'A worldwide AI slowdown could require coercive enforcement, creating another risk through concentrated political power.', sources: [2] }], connections: '', ideas: [
    { title: 'Stagnation also carries political risks', claim: 'A society without progress can become unstable as younger generations lose confidence in the future.', reasoning: 'He connects expectations of intergenerational improvement with a functioning middle-class society.', example: 'He challenges the assumption that zero growth would leave a peaceful social democracy.', caveat: 'He accepts AI risk for the sake of argument; he does not establish a probability.', sources: [1] },
    { title: 'Enforcing a global slowdown could concentrate power', claim: 'Effective global coordination could require a world government with coercive power.', reasoning: 'He worries that the enforcement mechanism could become worse than the risk it addresses.', example: '', caveat: '', sources: [2] }
  ], evaluation: [{ claim: 'Slowing AI also has costs', support: 'He proposes a mechanism connecting lost progress to instability.', limits: 'That does not compare the effects of a targeted slowdown with stopping all progress.', test: 'Examine whether a specific precaution would preserve other sources of growth.', sources: [1] }],
    unanswered: ['Which specific safety measures would he support?'], model: 'Fixture model', sections: 1 }
  const transcript = { videoId: 'B7yl7fEHeKM', title: 'Peter Thiel: The AI Crisis, Europe’s Decline & the Battle for America', language: 'en', automatic: true, duration: 3921, source: 'caption-track', complete: true, segments: [ { start: 327, duration: 40, text: 'It does not necessarily follow that you should always go slower. If there is no progress, I do not think our societies work at all.' }, { start: 445, duration: 30, text: 'I think that would require a one world government with real teeth, real force.' } ] }
  const html = readFileSync('out/extension/sidepanel.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '')
  writeFileSync('out/extension/preview.html', html)
  await win.loadFile(resolve('out/extension/preview.html'))
  await win.webContents.executeJavaScript(`
    window.fixtureState = {
      mode: 'success', requests: [], connections: 0, disconnects: 0, modelMs: 180, captureMs: 90, pingMs: 60, cacheClearFails: false, copyFails: false, copied: '',
      transcript: ${JSON.stringify(transcript)}, analysis: ${JSON.stringify(fixture)},
      stored: {'target:1': {tabId:2,windowId:1,videoId:'B7yl7fEHeKM',title:${JSON.stringify(transcript.title)},start:true,token:'fixture',clickedAt:performance.timeOrigin+performance.now()-600}}
    };
    const state = window.fixtureState;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
      if (state.copyFails) throw new Error('Fixture clipboard failure');
      state.copied = text;
    } } });
    window.chrome = {
      windows: { getCurrent: async () => ({id:1}) },
      storage: { session: {
        get: async () => state.stored,
        set: async values => { Object.assign(state.stored, values) }
      }, onChanged: { addListener: f => state.onChange = f } },
      tabs: { query: async () => [], onUpdated: {addListener: f => state.onUpdated = f}, onRemoved: {addListener: f => state.onRemoved = f} },
      scripting: { executeScript: async options => {
        if (options.args?.length === 1) return [{result:state.wrongVideo ? null : state.currentTime ?? 0}];
        if (options.args?.length === 2) {state.seek=options.args;return [{result:!state.wrongVideo}]}
        state.captureStartedAt = performance.now();
        const snapshot = {...state.transcript};
        await new Promise(resolve => setTimeout(resolve, state.captureMs));
        state.captureFinishedAt = performance.now();
        if (state.captureFails) throw new Error('Fixture capture failure');
        return [{result:{transcript:snapshot}}];
      } },
      runtime: { connectNative: () => {
        state.connections++;
        let listener, onDisconnect, timer;
        return {
          onMessage: {addListener: f => listener=f}, onDisconnect: {addListener: f => onDisconnect=f},
          disconnect: () => {clearTimeout(timer);state.disconnects++},
          postMessage: r => {
            state.requests.push(r);
            if (r.action === 'analyze') state.analyzePostedAt = performance.now();
            const cached = r.action === 'analyze' && state.mode === 'cache' && !r.fresh;
            timer = setTimeout(() => {
              if (r.action === 'ping') state.pingFinishedAt = performance.now();
              if (r.action === 'ping' && state.pingFails) {listener({id:r.id,type:'error',message:'Fixture connection failure'});return}
              if (r.action === 'analyze' && state.mode === 'failure') {listener({id:r.id,type:'error',message:'Fixture provider failure'});return}
              if (r.action === 'clear-cache' && state.cacheClearFails) {listener({id:r.id,type:'error',message:'Fixture cache access failure'});return}
              let result = r.action === 'ping' ? {model:'Fixture model'} : state.analysis;
              if (r.action === 'clear-cache') {result={cleared:2,failed:0};state.mode='success'}
              if (r.action === 'translate') result = {...result,overview:'蒂尔认为，人工智能的风险需要与停滞带来的政治风险一起衡量。',takeaways:result.takeaways.map(x=>({...x,text:'停滞也有风险。'})),ideas:result.ideas.map(x=>({...x,title:'停滞也带来政治风险'})),evaluation:result.evaluation.map(x=>({...x,claim:'检验这个观点',support:'提出了一个机制。',limits:'还没有比较两种选择。',test:''}))};
              if (r.action === 'question') result = {answer:'He sees stagnation as another source of risk.',sources:[1]};
              if (r.action === 'watch-plan') {
                if (state.planFails) {listener({id:r.id,type:'error',message:'Fixture plan failure'});return}
                result = {...state.plan,model:'gpt-6-luna'};
              }
              listener({id:r.id,type:'result',result,cached,timing:r.action === 'analyze' ? {modelMs:cached?0:state.modelMs} : undefined});
            }, r.action === 'ping' ? state.pingMs : r.action === 'analyze' && !cached ? state.modelMs + 70 : 20);
          }
        };
      } }
    };
    state.navigate = (videoId, start=true, token=crypto.randomUUID(), action='analyze') => {
      state.transcript = {...state.transcript,videoId};
      const next = {...state.stored['target:1'],videoId,start,token,action,clickedAt:performance.timeOrigin+performance.now()};
      state.stored['target:1'] = next;
      state.onChange({'target:1':{newValue:next}},'session');
    };
    void 0
  `)
  const script = readFileSync('out/extension/sidepanel.js', 'utf8')
  await win.webContents.executeJavaScript(`(async()=>{${script}\n})()`)
  const read = code => win.webContents.executeJavaScript(code)
  const waitFor = async condition => {
    for (let i=0;i<100;i++) {
      if (await read(condition)) return;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error(`Panel condition timed out: ${condition}`)
  }
  const finished = () => waitFor('!document.getElementById("understand").disabled')
  const total = () => read('document.getElementById("timing-total").textContent')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Elapsed')
  assert.equal(await read('document.getElementById("panel-heading").textContent'), 'Understand video')
  assert.equal(await read('document.getElementById("plan-watch").hidden'), true, 'summary controls do not include planning')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true, 'does not guess the source while waiting')
  assert.equal(await read('document.getElementById("clear-cache").disabled'), true, 'cache clearing cannot interrupt a summary')
  assert.ok(parseFloat(await total()) >= 0.6, 'includes time before the panel starts')
  await waitFor('fixtureState.requests.at(-1)?.action === "analyze"')
  const capturedSize = await read('document.getElementById("transcript-size").textContent')
  assert.match(capturedSize, /^Captured 39 words · ≈[\d,]+ tokens \(estimated\)$/, 'counts the caption words, not the title or summary')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), false, 'input size appears before the model finishes')
  // Background metadata updates now retain the original click. Deliver the same
  // pending token while busy, and again after completion, without a second run.
  await read(`fixtureState.updateTitle = title => {
    const next = {...fixtureState.stored['target:1'],title};
    fixtureState.stored['target:1']=next;
    fixtureState.onChange({'target:1':{newValue:next}},'session');
  };fixtureState.updateTitle('Delayed YouTube title - YouTube')`)
  await finished()
  await read("fixtureState.updateTitle('Final YouTube title - YouTube')")
  assert.equal(await read('fixtureState.requests.filter(r=>r.action==="analyze").length'), 1, 'one click produces one summary despite title updates')
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize)
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("details.idea").length'), 2)
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("overview-card").hidden'), false)
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("ideas-section").open'), false)
  assert.equal(await read('document.querySelectorAll("#takeaways > li").length'), 2)
  assert.equal(await read('document.getElementById("connections-details").hidden'), true)
  assert.equal(await read('document.querySelectorAll(".evidence[open]").length'), 0, 'source quotes start collapsed')
  assert.equal(await read('getComputedStyle(document.getElementById("overview")).fontSize'), '18px')
  assert.equal(await read('getComputedStyle(document.querySelector(".claim")).fontSize'), '18px')
  assert.equal(await read('document.getElementById("evaluation-section").hidden'), false)
  assert.equal(await read('document.getElementById("evaluation-section").open'), false, 'critical assessment starts collapsed')
  assert.equal(await read('document.querySelectorAll("#evaluation .assessment").length'), 1)
  assert.equal(await read('document.getElementById("overview-card").textContent.includes("targeted slowdown")'), false, 'model criticism is separate from the speaker summary')
  await read('document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Copied")')
  const copied = await read('fixtureState.copied')
  assert.match(copied, /## Key takeaways/)
  assert.match(copied, /Enforcing a global slowdown could concentrate power/)
  assert.match(copied, /world government with coercive power/)
  assert.match(copied, /&t=445s/)
  assert.match(copied, /## Critical assessment/)
  assert.match(copied, /targeted slowdown/)
  assert.match(copied, /External facts have not been checked/)
  await read('fixtureState.copyFails=true;document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Could not copy")')
  await read('fixtureState.copyFails=false;document.getElementById("copy-status").textContent=""')
  const firstTotal = await total()
  assert.ok(parseFloat(firstTotal) >= 0.93, 'total includes opening, ping, collection and model')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Summary ready')
  assert.equal(await read('document.getElementById("timing-request").textContent'), '0.18 s')
  const freshSource = 'Fresh model response'
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource)
  assert.equal(await read('document.getElementById("timing-app-details").open'), false)
  assert.equal(await read('document.getElementById("timing-request").getBoundingClientRect().height > 0'), true, 'main timings are visible without expanding details')
  assert.equal(await read('document.getElementById("timing-source").getBoundingClientRect().height > 0'), true, 'origin is visible without opening timing details')
  const transcriptTime = parseFloat(await read('document.getElementById("timing-transcript").textContent'))
  const openingTime = parseFloat(await read('document.getElementById("timing-opening").textContent'))
  const connectionTime = parseFloat(await read('document.getElementById("timing-connection").textContent'))
  const transferTime = parseFloat(await read('document.getElementById("timing-transfer").textContent'))
  const displayTime = parseFloat(await read('document.getElementById("timing-display").textContent'))
  assert.ok(transcriptTime >= 0.08, 'caption loading is separately measured')
  assert.ok(openingTime >= 0.6, 'opening time remains separate from the helper connection')
  assert.ok(connectionTime >= 0, 'connection only counts extra wait beyond caption loading')
  assert.equal(await read('fixtureState.captureStartedAt < fixtureState.pingFinishedAt'), true, 'caption capture starts before the helper responds')
  assert.equal(await read('fixtureState.analyzePostedAt >= Math.max(fixtureState.pingFinishedAt, fixtureState.captureFinishedAt)'), true, 'analysis waits for both prerequisites')
  assert.ok(transferTime >= 0.06, 'non-model request time is separately measured')
  assert.ok(Math.abs(parseFloat(firstTotal) - openingTime - connectionTime - transcriptTime - 0.18 - transferTime - displayTime) <= 0.012, 'breakdown accounts for total without double-counting parallel stages')
  const appTime = parseFloat(await read('document.getElementById("timing-app").textContent'))
  assert.ok(Math.abs(parseFloat(firstTotal) - transcriptTime - 0.18 - appTime) <= 0.02, 'three main rows account for total')
  assert.equal(await read('fixtureState.connections'), 1, 'ping and analysis share one helper')
  assert.equal(await read('fixtureState.disconnects'), 0, 'successful requests keep the helper warm')
  assert.equal(await read('document.getElementById("understand").textContent'), 'Summarize again')
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  mkdirSync('out/verification', { recursive: true })
  writeFileSync('out/verification/panel-english.png', (await win.webContents.capturePage()).toPNG())
  writeFileSync('out/verification/panel-timing.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("timing-app-details").open=true; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-timing-details.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(360, 1150)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'timing explanations fit a narrow panel')
  writeFileSync('out/verification/panel-timing-details-narrow.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(440, 1150)
  await read('document.getElementById("timing-app-details").open=false')
  await win.webContents.executeJavaScript('document.getElementById("ideas-section").open=true; document.querySelector("details.idea").open=true; document.getElementById("ideas-section").scrollIntoView(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-breakdown.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(360, 1000)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'large reading text fits a narrow panel')
  writeFileSync('out/verification/panel-breakdown-narrow.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("evaluation-section").open=true;document.getElementById("evaluation-section").scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'critical assessment fits a narrow panel')
  writeFileSync('out/verification/panel-evaluation.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(440, 1150)
  await win.webContents.executeJavaScript('document.getElementById("chinese").click()')
  await finished()
  assert.match(await win.webContents.executeJavaScript('document.getElementById("overview").textContent'), /蒂尔/)
  await read('document.getElementById("copy-summary").click()')
  await waitFor('fixtureState.copied.includes("核心") || fixtureState.copied.includes("蒂尔")')
  assert.match(await read('fixtureState.copied'), /停滞也有风险。/)
  assert.match(await read('fixtureState.copied'), /检验这个观点/)
  assert.equal(await read('document.querySelectorAll("#evaluation .detail-text").length'), 2, 'empty proposed checks are omitted')
  await win.webContents.executeJavaScript('document.getElementById("english").click(); document.getElementById("question").value="What is his reasoning?";document.getElementById("question-form").requestSubmit()')
  await finished()
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#conversation .answer").length'), 1)
  assert.equal(await total(), firstTotal, 'translation and questions do not overwrite summary time')
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'origin remains attached to the original summary timing')
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize, 'translation and questions retain captured input counts')
  assert.equal(await read('fixtureState.connections'), 1, 'translation and questions reuse the same helper')

  await read('fixtureState.mode="cache";fixtureState.navigate("jNQXAC9IVRw")')
  await finished()
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Saved summary loaded')
  assert.equal(await read('document.getElementById("timing-request").textContent'), 'Not called (cached)')
  assert.equal(await read('document.getElementById("timing-source").textContent'), 'Cached summary · No model call')
  assert.equal(await read('document.getElementById("timing-source").getBoundingClientRect().height > 0'), true)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-cached.png', (await win.webContents.capturePage()).toPNG())
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize, 'cached summaries show current transcript counts')
  assert.equal(await read('fixtureState.connections'), 1, 'navigation keeps an idle helper warm for the new video')
  assert.equal(await read('fixtureState.disconnects'), 0, 'idle navigation does not restart the helper')
  await read('document.getElementById("understand").click()')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true, 'rerun clears previous cache origin')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), true, 'recapture clears old counts until captions load')
  await finished()
  assert.equal(await read('fixtureState.requests.at(-1).fresh'), true, 'rerun bypasses saved summary')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Summary ready')
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'rerun reports a fresh model response')
  assert.equal(await read('fixtureState.connections'), 1, 'repeat summary keeps the helper connection')

  const beforeClear = await read('fixtureState.requests.length')
  await read('fixtureState.cacheClearFails=true;document.getElementById("clear-cache").click()')
  await finished()
  assert.match(await read('document.getElementById("status").textContent'), /Could not confirm/)
  assert.equal(await read('document.getElementById("overview-card").hidden'), false, 'failed clear retains displayed summary')
  await read('fixtureState.cacheClearFails=false;document.getElementById("clear-cache").click()')
  await finished()
  assert.equal(await read('fixtureState.requests.length'), beforeClear + 2, 'clearing makes no analysis, translation or ping calls')
  assert.equal(await read('fixtureState.requests.at(-1).action'), 'clear-cache')
  assert.match(await read('document.getElementById("status").textContent'), /Cache cleared.*2 saved entries/)
  assert.equal(await read('document.getElementById("overview-card").hidden'), true)
  assert.equal(await read('document.getElementById("evaluation-section").hidden'), true)
  assert.equal(await read('document.getElementById("evaluation").childElementCount'), 0)
  assert.equal(await read('document.getElementById("timing").hidden'), true)
  assert.equal(await read('document.getElementById("languages").hidden'), true, 'cannot translate a removed cached analysis')
  assert.equal(await read('document.getElementById("clear-cache").disabled'), false)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-cache-cleared.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("understand").click()')
  await finished()
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'next summary is generated afresh')

  // Extra valid takeaways and themes must remain readable and exportable beyond
  // the prompt targets. The service tests cover their validation.
  await read(`fixtureState.analysis={...fixtureState.analysis,takeaways:Array.from({length:7},(_,index)=>({
    text:'Supported takeaway '+(index+1),sources:[1,2]
  })),ideas:Array.from({length:9},(_,index)=>({
    ...fixtureState.analysis.ideas[index%fixtureState.analysis.ideas.length],title:'Theme '+(index+1)
  }))};document.getElementById('understand').click()`)
  await finished()
  assert.equal(await read('document.getElementById("error").hidden'), true)
  assert.equal(await read('document.querySelectorAll("#takeaways > li").length'), 7)
  assert.equal(await read('document.querySelector("#takeaways > li:last-child > p").textContent'), 'Supported takeaway 7')
  assert.equal(await read('document.querySelectorAll("#ideas > details.idea").length'), 9)
  assert.equal(await read('document.getElementById("idea-count").textContent'), '· 9 key themes')
  assert.equal(await read('document.querySelector("#ideas > details.idea:last-child > summary").textContent'), 'Theme 9')
  await read('document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Copied")')
  assert.match(await read('fixtureState.copied'), /- Supported takeaway 7\n/)
  assert.match(await read('fixtureState.copied'), /### Theme 9/)
  console.log('All seven takeaways and nine themes render and copy, including entries beyond the prompt targets.')

  await read('fixtureState.mode="failure";document.getElementById("understand").click()')
  await finished()
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Failed after')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true)
  const failedTotal = await total()
  await new Promise(r => setTimeout(r, 150))
  assert.equal(await total(), failedTotal, 'failure freezes timer')

  await read('fixtureState.mode="success";fixtureState.modelMs=1000;fixtureState.requests=[];document.getElementById("understand").click()')
  await waitFor('fixtureState.requests.at(-1)?.action === "analyze"')
  await read('document.getElementById("cancel").click()')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Cancelled after')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true)
  const cancelledTotal = await total()
  assert.equal(await read('fixtureState.disconnects'), 2, 'failure and cancel each close the active helper')
  await new Promise(r => setTimeout(r, 150))
  assert.equal(await total(), cancelledTotal, 'cancellation freezes timer')
  await read('fixtureState.navigate("B7yl7fEHeKM",false)')
  assert.equal(await read('document.getElementById("timing").hidden'), true, 'navigation clears previous timing')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), true, 'navigation clears previous input counts')

  // Repeated delivery of a click in this panel must not restart work.
  const consumed = await read('({...fixtureState.stored["target:1"],start:true,token:fixtureState.stored["started:1"]})')
  await read(`fixtureState.onChange({'target:1':{newValue:${JSON.stringify(consumed)}}},'session')`)
  assert.equal(await read('document.getElementById("timing").hidden'), true)

  // YouTube changes the URL before the browser title. A later title-only event
  // must update the header without starting work, resetting state, or cancelling.
  await read(`fixtureState.modelMs=180;fixtureState.requests=[];
  fixtureState.navigate('jNQXAC9IVRw',false);
  fixtureState.updateTitle('New lecture - YouTube')`)
  assert.equal(await read('document.getElementById("video-title").textContent'), 'New lecture')
  assert.equal(await read('fixtureState.requests.length'), 0, 'a title change does not start a summary')

  // The captured player metadata is tied to the checked video ID. It also fixes
  // a stale tab title when its title event is delayed or never reaches the panel.
  await read(`fixtureState.updateTitle('Previous video - YouTube');
    fixtureState.transcript={...fixtureState.transcript,title:'Current lecture from the player'};
    document.getElementById('understand').click()`)
  await waitFor('fixtureState.requests.at(-1)?.action === "analyze"')
  assert.equal(await read('document.getElementById("video-title").textContent'), 'Current lecture from the player')
  await read("fixtureState.updateTitle('Late browser title - YouTube')")
  await finished()
  assert.equal(await read('document.getElementById("video-title").textContent'), 'Current lecture from the player')
  assert.equal(await read('document.getElementById("error").hidden'), true)
  assert.equal(await read('fixtureState.requests.filter(r=>r.action==="analyze").length'), 1)
  const titleUpdateTotal = await total()
  await read("fixtureState.updateTitle('Another delayed title - YouTube')")
  assert.equal(await total(), titleUpdateTotal, 'metadata updates preserve the completed summary timing')
  assert.equal(await read('document.getElementById("overview-card").hidden'), false)
  await read('document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Copied")')
  assert.match(await read('fixtureState.copied'), /^# Current lecture from the player\n/)
  assert.match(await read('fixtureState.copied'), /watch\?v=jNQXAC9IVRw/)
  await read("fixtureState.navigate('B7yl7fEHeKM',false);fixtureState.updateTitle('Next video - YouTube')")
  assert.equal(await read('document.getElementById("video-title").textContent'), 'Next video')
  assert.equal(await read('document.getElementById("overview-card").hidden'), true)
  console.log('Delayed title changes, captured video titles, copy titles, and navigation reset passed without extra summary requests.')

  // Parallel prerequisites must fail together without orphaning a helper request
  // or allowing late captions to mutate the failed/cancelled panel.
  await read('fixtureState.requests=[];fixtureState.captureFails=true;fixtureState.captureMs=20;fixtureState.pingMs=600;document.getElementById("understand").click()')
  await finished()
  assert.match(await read('document.getElementById("error").textContent'), /capture failure/)
  assert.equal(await read('fixtureState.requests.some(r=>r.action==="analyze")'), false)
  await read('fixtureState.captureFails=false;fixtureState.pingFails=true;fixtureState.pingMs=20;fixtureState.captureMs=200;document.getElementById("understand").click()')
  await finished()
  const connectionFailureTime = await total()
  await new Promise(r => setTimeout(r, 250))
  assert.equal(await total(), connectionFailureTime, 'late captions cannot change failed timing')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), true, 'late captions after connection failure are discarded')
  await read('fixtureState.pingFails=false;fixtureState.captureMs=200;fixtureState.requests=[];document.getElementById("understand").click();document.getElementById("cancel").click()')
  await new Promise(r => setTimeout(r, 250))
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Cancelled after')
  assert.equal(await read('fixtureState.requests.some(r=>r.action==="analyze")'), false, 'cancelled prerequisites never start the model')
  await read('fixtureState.captureMs=90;fixtureState.pingMs=60;document.getElementById("understand").click()')
  await finished()
  assert.equal(await read('document.getElementById("error").hidden'), true, 'explicit retry after parallel failure/cancellation works')
  const requestsBeforeWarmup = await read('fixtureState.requests.length')
  await read('fixtureState.navigate("jNQXAC9IVRw",false)')
  assert.equal(await read('fixtureState.requests.length'), requestsBeforeWarmup, 'idle warmup sends no model or transcript request')
  console.log('Parallel caption/connection loading, failure cleanup, cancellation, retry, and request-free warmup passed.')

  // Plan directly on a new video: no summary request or profile form is involved.
  await read(`fixtureState.captureMs=0;fixtureState.pingMs=0;fixtureState.modelMs=0;fixtureState.requests=[];
    fixtureState.transcript.description='A tutorial on mechanisms, with optional review and practical limitations.';
    fixtureState.plan={overview:'Focus on the mechanism and its practical limits; skim repeated background.',sections:[
      {firstCaption:1,lastCaption:1,title:'Repeated background',recommendation:'skip',reason:'Repeats the background without adding a new concept.',learningTarget:'',skipCondition:'You can explain the background; otherwise watch this section.',prerequisites:[]},
      {firstCaption:2,lastCaption:2,title:'Mechanism and limitations',recommendation:'focus',reason:'These constraints change how the method applies.',learningTarget:'Explain when the mechanism applies.',skipCondition:'',prerequisites:[]}
    ]};fixtureState.navigate('jNQXAC9IVRw',true,crypto.randomUUID(),'watch-plan')`)
  await finished()
  assert.deepEqual(await read('fixtureState.requests.map(r=>r.action)'), ['ping','watch-plan'])
  assert.equal(await read('document.getElementById("watch-result").hidden'), false)
  assert.equal(await read('document.getElementById("summary-view").hidden'), true)
  assert.equal(await read('document.getElementById("summary-timing-view").hidden'), true)
  assert.equal(await read('document.getElementById("panel-heading").textContent'), 'Plan watch')
  assert.equal(await read('document.getElementById("understand").hidden'), true, 'planning controls do not include summaries')
  assert.equal(await read('document.getElementById("plan-watch").hidden'), false)
  assert.equal(await read('document.querySelector("#watch-goal, #watch-known, #watch-budget, #watch-form")'), null)
  assert.equal(await read('"preferences" in fixtureState.requests.at(-1)'), false)
  assert.match(await read('fixtureState.requests.at(-1).transcript.description'), /practical limitations/)
  assert.equal(await read('document.querySelector(".watch-skip details").open'), true, 'skip conditions are visible')
  await read('fixtureState.currentTime=400;document.getElementById("next-focus").click()')
  await waitFor('fixtureState.seek?.[1]===445')
  assert.equal(await read('fixtureState.seek[0]'), 'jNQXAC9IVRw')
  await read('fixtureState.currentTime=450;document.getElementById("next-focus").click()')
  await waitFor('document.getElementById("watch-status").textContent.includes("No later focus")')
  await read('fixtureState.wrongVideo=true;document.getElementById("next-focus").click()')
  await waitFor('document.getElementById("error").textContent.includes("original video")')
  await read('fixtureState.wrongVideo=false;fixtureState.navigate("jNQXAC9IVRw",true,crypto.randomUUID(),"analyze")')
  await finished()
  assert.equal(await read('fixtureState.requests.at(-1).action'), 'analyze')
  assert.equal(await read('document.getElementById("watch-plan-section").hidden'), true)
  assert.equal(await read('document.getElementById("summary-view").hidden'), false)
  const summaryClock = await total()
  await read('fixtureState.navigate("jNQXAC9IVRw",true,crypto.randomUUID(),"watch-plan")')
  await finished()
  assert.equal(await read('fixtureState.requests.at(-1).fresh'), true)
  assert.equal(await total(), summaryClock, 'planning preserves the completed summary clock')
  assert.equal(await read('document.getElementById("error").hidden'), true)
  const retained = await read(`
    fixtureState.originalTarget = fixtureState.stored['target:1'];
    fixtureState.originalPlan = document.getElementById('watch-result');
    document.querySelector('.watch-focus details').open = true;
    window.scrollTo(0, 500);
    ({scroll:window.scrollY,requests:fixtureState.requests.length})
  `)
  assert.ok(retained.scroll > 0)
  await read(`
    fixtureState.onChange({'target:1':{newValue:{...fixtureState.originalTarget,tabId:3,videoId:null,start:false,token:'other-tab'}}},'session');
    fixtureState.onChange({'target:99':{newValue:{...fixtureState.originalTarget,windowId:99}}},'session');
    fixtureState.onChange({'target:1':{newValue:fixtureState.originalTarget}},'session');
    new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  `)
  assert.equal(await read('document.getElementById("watch-result") === fixtureState.originalPlan'), true, 'tab return restores the original rendered plan')
  assert.equal(await read('document.querySelector(".watch-focus details").open'), true, 'expanded sections survive tab switching')
  assert.equal(await read('window.scrollY'), retained.scroll, 'scroll position survives tab switching')
  assert.equal(await read('fixtureState.requests.length'), retained.requests, 'tab switching does not request another plan')
  await read('window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'watch plan fits the panel')
  mkdirSync('out/verification', {recursive:true})
  writeFileSync('out/verification/watch-plan-panel.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(360, 1000)
  await read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'dedicated plan controls fit a narrow panel')
  writeFileSync('out/verification/watch-plan-panel-narrow.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(440, 1150)
  await read('fixtureState.planFails=true;document.getElementById("plan-watch").click()')
  await finished()
  assert.match(await read('document.getElementById("watch-status").textContent'), /did not finish/)
  await read('fixtureState.planFails=false;document.getElementById("plan-watch").click();document.getElementById("cancel").click()')
  assert.match(await read('document.getElementById("watch-status").textContent'), /cancelled/)
  await read('fixtureState.requests=[];fixtureState.navigate("lecturetest",true,crypto.randomUUID(),"watch-plan")')
  await finished()
  assert.deepEqual(await read('fixtureState.requests.map(r=>r.action)'), ['ping','watch-plan'], 'the YouTube Plan watch action starts planning on a new video')
  await read('document.getElementById("plan-watch").click();fixtureState.navigate("jNQXAC9IVRw",false)')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(await read('document.getElementById("watch-result").hidden'), true, 'navigation removes the old plan and ignores late results')
  // A new explicit page action can replace an in-progress summary with a plan.
  await read('fixtureState.modelMs=150;fixtureState.requests=[];document.getElementById("understand").click()')
  await waitFor('fixtureState.requests.at(-1)?.action==="analyze"')
  await read('fixtureState.navigate("jNQXAC9IVRw",true,crypto.randomUUID(),"watch-plan")')
  await finished()
  assert.equal(await read('fixtureState.requests.at(-1).action'), 'watch-plan')
  assert.equal(await read('document.getElementById("summary-view").hidden'), true)
  console.log('Independent watch-plan actions, metadata capture, separate views, seeking, retry, cancellation, and navigation passed.')

  console.log('Summary, breakdown, separate critical assessment, 18px/narrow layout, full/translated copy, and existing timing/cache/cancel flows passed.')
  unlinkSync(resolve('out/extension/preview.html'))
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
