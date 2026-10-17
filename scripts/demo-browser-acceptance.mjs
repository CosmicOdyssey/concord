/** Run in Codex's connected browser runtime, not a mock or a second browser driver.
 * const {acceptDemo} = await import('/absolute/repo/scripts/demo-browser-acceptance.mjs');
 * const evidence = await acceptDemo(tab);
 * Tab APIs: documented cua/Playwright facade. Throws on any failed scene/metric.
 */
export async function acceptDemo(tab) {
  const trials = []
  const check = (ok, message) => { if (!ok) throw new Error(message) }
  const visible = async text => tab.playwright.getByText(text, {exact:false}).waitFor({state:'visible',timeoutMs:15000})
  for (let i=0;i<3;i++) {
    const started = Date.now(); const steps=[]; let prior=started
    const stamp = scene => { const now=Date.now();steps.push({scene,automation_elapsed_ms:now-prior});prior=now }
    await tab.playwright.getByRole('button',{name:'Reset Demo',exact:true}).click()
    await visible('Known baseline computed locally. Optimization has not run.')
    stamp('problem')
    await tab.playwright.getByRole('button',{name:'Next Scene',exact:true}).click()
    await visible('A feasible baseline leaves a bottleneck.')
    await visible('15.13 mo')
    stamp('baseline')
    await tab.playwright.getByRole('button',{name:'Optimize Portfolio',exact:true}).click()
    await visible('Live computation completed')
    const status=await tab.playwright.getByTestId('demo-status').innerText()
    check(/OPTIMAL/.test(status),'Missing exact search label')
    await visible('9.24 mo')
    await visible('This uses more sponsor funding—not savings.')
    stamp('compute-and-compare')
    await tab.playwright.getByRole('button',{name:'Next Scene',exact:true}).click()
    await visible('Who pays—and what is the evidence?')
    await visible('Coverage classification only. No payer commitment or partnership.')
    const runLine = await tab.playwright.getByText(/^Run [a-f0-9]{32}$/).innerText()
    const computedLine = await tab.playwright.getByText(/^Live computation · /).innerText()
    const resultLine = await tab.playwright.getByText(/^Result [a-f0-9]{64}$/).innerText()
    const href = await tab.playwright.getByRole('link',{name:'Open Evidence Report',exact:true}).getAttribute('href')
    check(href.includes(runLine.slice(4)), 'Report belongs to another run')
    stamp('money-and-evidence')
    await tab.playwright.getByRole('button',{name:'Next Scene',exact:true}).click()
    await visible('A planning decision, not a clinical promise.')
    stamp('conclusion')
    trials.push({rehearsal:i+1,main_clicks:4,setup_reset_clicks:1,status,run_id:runLine.slice(4),result_sha256:resultLine.slice(7),computed_label:computedLine,steps,total_automation_ms:Date.now()-started,passed:true})
  }
  check(new Set(trials.map(t=>t.run_id)).size===1,'Seeded reruns changed immutable result')
  check(new Set(trials.map(t=>t.computed_label)).size===3,'Reruns did not record distinct compute times')
  return {schema_version:1,observed_at:new Date().toISOString(),source:'Real connected browser; actual loopback backend; no response mocking',timing_scope:'Automation action/observation latency, not human speech or staged dwell time',trials}
}
