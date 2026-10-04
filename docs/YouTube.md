# Understand YouTube videos

The optional Chrome/Edge companion reads the available caption transcript and
produces an **English analysis**: the main argument, expandable positions, reasoning,
examples, qualifications, and links to the supporting moments. **Translate to Chinese**
translates that existing analysis only when you ask. Follow-up questions consult the
original captions, including material omitted from the overview.

## Install the personal version

From this checkout, run:

```powershell
npm install
npm run setup:youtube
```

This builds EasyUnderstand and the companion, and registers a native messaging host
for your Windows user in Chrome and Edge. On macOS it writes the equivalent user
native-host manifests. Windows is the verified platform for this first version.

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select the **out/extension**
   folder inside this checkout (not the source `extension` folder).
3. Open EasyUnderstand Settings → **YouTube analysis**. The default is **Gemini 3.8
   Flash**, with its own model, endpoint and API key. Your existing everyday
   translation/explanation settings are preserved. Click **Get this provider’s API
   key**, create a Gemini API key, paste it into **Video API key**, and click **Save**.
   Then click **Test video model**. The test makes a small paid/free-tier request
   through the same streaming JSON and citation checks as analysis. It reports
   missing credentials, denied access, unknown model IDs, and quota errors. Passing
   the test confirms access and response structure; review your first video for
   accuracy and depth. Enter keys in Settings, not in chat.
4. Reload an existing YouTube tab. Click **Understand video** next to the video’s
   controls, or click the companion’s browser toolbar icon.

The companion warms a windowless worker when its panel has a YouTube video selected.
Warmup starts only the local process; it sends no captions or model requests.
The connection is reused for model checks, summaries, translations, and questions,
including across videos while the panel stays open. Navigating during an active
request cancels that request; idle navigation keeps the worker ready. Cancel,
leaving YouTube, and closing the panel release the worker. A disconnected request
is not automatically replayed; the next explicit request opens a new connection.
The tray app does not have to be
running. Chrome’s own Ask button remains available. No ChatGPT tab is involved;
requests use the model API configured in EasyUnderstand and its applicable pricing
or free-tier allowance.

After updating code, run `npm run setup:youtube` again, restart the desktop app for
updated Settings, click **Reload** on the extension’s browser card, and reload YouTube. Keep this checkout in place: the native
host registration and unpacked extension refer to its absolute paths.

The Windows source installer also accepts `-YouTube` to register the companion.
It still requires the one-time browser **Load unpacked** step. This is a local
installation, not a Chrome Web Store or Edge Add-ons publication.

## Use it

- Click **Understand video**. Caption reading and summarization show progress.
  The native YouTube transcript panel may open automatically during collection.
- After collection, the complete transcript is sent once. The model generates one
  response containing both the summary and the breakdown, then the request ends.
  A call stops after 60 seconds without initial text, 45 seconds without further
  text, or three minutes total. Invalid summaries are reported without another call.
- The live **Elapsed** clock runs from clicking the YouTube/panel button until the
  summary is ready to display, including panel opening and connection. The final
  **Summary ready** time stays visible in seconds to two decimal places, with three
  rows: **Transcript loading**, **Model request**, and **App setup & display**.
  Expand the app row for **Open sidebar**, **Connect to app**, **Prepare and deliver**,
  and **Show summary**, each with an explanation and three-decimal precision.
  Model request time includes provider/network waiting, the full response stream,
  and JSON validation; it is not a provider-only inference measurement. Captions
  load while the local app connects. Connection time counts only panel preparation
  and the extra wait beyond caption loading, so overlapping stages are not counted
  twice. Prepare and deliver is the analysis request round trip minus model time,
  including preparation, cache access, and communication. Show summary measures
  rendering and waiting for the browser to paint. Hidden panels finish when rendered.
- The timer always shows the result source: **Fresh model response**
  or **Cached summary · No model call**, with model time in its own row. Cache refers
  to EasyUnderstand's saved summary. Cached totals cover
  caption collection, connection, cache loading, and display. Click **Summarize again**
  to bypass the local summary cache and make one
  fresh model request. Compare the same video and output settings; changing the
  video model in Settings takes effect on the next run. Translation and follow-up
  questions leave the completed summary timing unchanged. Cancelled/failed runs
  freeze with their outcome and are not shown as completed speed measurements.
- Read the overview and **Key takeaways** first. Summaries adapt to the video's
  purpose: lectures explain concepts and how they connect; tutorials explain the
  demonstrated method; discussions explain positions and their reasoning. Course
  introductions distinguish what this session teaches from topics planned for later
  lectures, keeping logistics secondary. Takeaways preserve substantive closing
  lessons and important stated learning or project expectations. Examples clarify
  the material rather than determining the summary's structure. The prompt targets
  1–3 takeaways for short transcripts and 4–6 for long ones. Extra valid takeaways
  are preserved up to a 30-item output bound; every point still needs readable text
  and valid supporting caption IDs. A seventh takeaway does not fail the summary.
  Open **Explore the breakdown** for added depth. The prompt targets 4–6 entries,
  around 60–90 words each in total, with up to 8 when needed. This is a prompt
  target: extra valid entries are preserved rather than failing the whole summary
  or dropping content. Responses remain bounded at 30 entries, with all citation
  and field-size checks enforced. Examples and caveats
  are optional; caveats must be material qualifications actually stated by the
  speaker. Empty fields are omitted. **Sources** inside
  each theme reveals timestamp links and caption excerpts. Reading text is 18px.
- Open **Critical assessment** for a separate assessment of up to 3 substantive
  claims: support offered, assumptions and limits, and evidence that could test
  them. For teaching, it focuses on claims about results, methods or applicability;
  definitions and course objectives do not need a manufactured debate. It is omitted
  when no substantive assessment is warranted. It evaluates the captions and reasoning;
  it does not check external facts or manufacture objections.
  This assessment is generated in the same request as the summary and breakdown.
- **Copy summary + breakdown** copies the current language's overview, takeaways,
  every theme and critical assessment (including collapsed ones), unresolved questions, video URL, model
  name and timestamp links as plain Markdown. It does not copy the raw transcript
  or make a model request. Paste it into another model to review the analysis.
  Clipboard access is write-only and used when you click the button.
- **Inspect the source transcript** shows the collected text and timestamps.
- As soon as captions load, **Captured … words · ≈… tokens (estimated)** shows
  their size beside the transcript details. Words use Unicode word boundaries.
  The local token estimate uses UTF-8 bytes divided by four; actual tokenization
  varies by model and language. Both counts cover caption text only, excluding
  the title, timestamps, citation IDs, and instructions. These are not billed
  request tokens. Counts remain visible with saved summaries and translations.
- Ask a follow-up below the analysis. Questions are answered in English from the
  original transcript. The last few exchanges provide conversational context.
- Click **Translate to Chinese** when useful; switch between **English** and **中文**.
  This uses your everyday explanation model and key to translate the existing
  analysis. Analysis and follow-up questions always use the independent video model.
- Switching videos clears the panel and cancels the old request. Closing the panel
  disconnects its worker. Completed English/Chinese analyses are cached locally.
- **Clear cache** beside Understand video removes all locally saved video summaries
  and translations and clears the current panel. It makes no model request and
  leaves API keys, settings and everyday translation history intact. Saved results
  otherwise expire after 7 days, with at most 30 entries in total.

## Plan a lecture

Click **Plan watch** beside **Understand video** below the YouTube player.
One click opens the dedicated **Plan watch** sidebar view and starts planning:
it collects the title, description, and complete captions, then requests a watch
plan. You do not need a summary first, and there are no learning-goal, familiar-topic,
or time-budget inputs. **Understand video** continues to generate summaries only.
Each view shows only the controls and result for the action you chose. Use the
buttons below the video to switch views and start that action immediately.
**Plan again** and **Summarize again** request fresh results in their respective views.
Switching tabs or windows preserves each tab's view, expanded sections, and scroll
position. A pending plan or summary can finish while you are on another tab.
Opening a different video in that tab clears its previous view, including when
the navigation happens in the background. Closing a tab releases its view.
If the browser recreates the panel, it loads the requested result again, using the
saved result when available. An earlier startup cannot leave the new panel idle.

The model infers the video's learning objective, intended audience, and appropriate
emphasis from its title and description, then checks that interpretation against
what the captions actually teach. The description comes from the player metadata
matched to the current video. If it is unavailable, planning uses the title and
captions. Metadata is context, never instructions or evidence that advertised
material was taught. The model does not infer your personal mastery or available
time from a video's intended audience.

The chronological plan labels sections **Focus**, **Skim**, **Skip**, or **Check
visuals**. Expand **Why this section** for its reason, learning target, and needed
earlier sections. Skip conditions and visual checks start expanded. Recommendations
are learning advice, not statements made by the lecturer. They preserve whole
explanations and required prerequisite chains. The model can still make a poor
judgment, so read the reason before skipping.

Time ranges come from caption boundaries. Every caption must belong to exactly
one section; incomplete or overlapping model output fails instead of being shown
as a complete route. Uncaptioned intervals longer than 15 seconds are separated
as **Check visuals**, including gaps inside sections the model recommends skipping.
Captions cannot establish what is shown in slides, equations, or silent demos.
Shorter gaps are included with adjacent captioned material.

Click a time range to seek, or **Next focus section** to jump to the next focus
range after your current playback position. At the last focus section, use its
timestamp to revisit it. Playback is never automatically skipped or sped up.
Estimated viewing time counts focus and visual checks at 1×, skim at 1.5×, and
excludes conditional skips. Pauses and practice add time.

Planning uses the same video provider, endpoint, deployment, reasoning setting,
and dedicated key as summaries, including Azure OpenAI GPT-6 Luna. It makes one
explicit model request for the English plan. Summary translation does not translate
watch plans. Saved plans are keyed by the title, description, complete transcript,
model settings, and prompt version, sharing the summary cache's 7-day expiry and
30-entry bound. **Plan again** makes a fresh request. **Clear cache** removes plans,
summaries, and translations while retaining keys. Navigation and Cancel discard
pending results. A new explicit YouTube action can replace a pending request.
Planning preserves the completed summary timer, which is shown only in summary view.

For an explicit live check with a captured transcript and the configured model:

```powershell
node scripts/verify-video-model.mjs --live --watch-plan --transcript path/to/transcript.json --fresh
```

The transcript may include a `description` string from the matching video's player
metadata. This check uses the configured API and its applicable charges.

## Use an Azure GPT-6 deployment

In **Settings → YouTube analysis**, select **Azure OpenAI — GPT-6 Luna · faster
summaries** to try lower latency, or **Azure OpenAI — GPT-6 Astra** for the existing
configuration:

- **Azure deployment name:** your deployment's name, for example `gpt-6-luna`.
  You must first have that model deployed in your Azure resource. The preset does
  not create a deployment. Switching Azure presets preserves the resource endpoint.
- **Video reasoning effort:** Luna starts at **None**; Astra starts at **Low**.
  Choose only an effort supported by the underlying model. Deployment names are
  user-defined, so the app uses this setting explicitly rather than guessing.
- **Azure Responses endpoint:** the full resource URL, for example
  `https://YOUR-RESOURCE-NAME.cognitiveservices.azure.com/openai/responses?api-version=2025-04-01-preview`.
- **Video API key:** your Azure resource key. The field starts empty. Save it here,
  then click **Test video model**. An existing Gemini or everyday key is not reused.

This integration uses the versioned **Responses API**: `instructions` + `input`,
`max_output_tokens`, streamed response events and Azure's `api-key` header. A sample
that calls `client.chat.completions.create(...)` uses a different API route/schema;
do not paste its resource root or Chat Completions URL into the Responses field.
The `api-version` in the URL is preserved rather than replaced with a demo's version.
The deployment name, not an assumed underlying model name, goes into `model`.

Microsoft [lists GPT-6 Astra as supported by Azure Responses](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/responses?view=foundry-classic).
Your resource, region, deployment, selected API version and key still need an
authenticated connection test. A 404 can indicate the deployment or API version;
401/403 indicate credentials or permissions; 429 indicates rate/quota limits.
The implementation has been tested with local Azure API fixtures and complete
transcripts using an authenticated deployment. These checks verify the request
path and response structure; they are not independent accuracy evaluations. It
does not automatically switch to another model or API on failure.

Requests use the selected reasoning effort and `store: false`. Existing Azure
configurations without an effort setting retain **Low**. [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
supports **None**, which avoids reasoning-token overhead; Astra requires **Low** or
higher. Microsoft lists Luna among [models sold directly by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure).
Availability depends on your resource, region and quota. Azure charges depend on
your deployment pricing; the Gemini rates below do not apply. Reasoning counts
toward the response token limit. A sub-10-second summary is a benchmark target,
not a guarantee: compare fresh responses on the same full transcript for both
accuracy and model time. One fresh Luna run on a 5-hour-15-minute transcript
(about 53,000 words) completed the model request in 11.448 seconds and the native
helper in 12.837 seconds. That helper measurement excludes browser opening,
caption collection and display, and is a single observation, not a latency guarantee.
Incomplete, failed, refused or disconnected streams are reported as errors instead
of being cached as complete analyses. Everyday translations remain separate.

## Scope and limitations

The default was checked against Google's official documentation on **2026-09-26**:
[Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
is stable, accepts 1,048,576 input tokens and supports structured output. The
[OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai) is
`https://generativelanguage.googleapis.com/v1beta/openai`, model `gemini-3.8-flash`.
[Standard paid pricing](https://ai.google.dev/gemini-api/docs/pricing) is $0.75 input
and $3.75 output per million tokens through December 31, 2026, rising to $1.50/$7.50
on January 1, 2027. Thinking tokens count as output. For illustration, 60,000 total
input plus 3,000 total output tokens for one summary cost about $0.056 at the current
rate. This is a token-budget example, not a measured per-video charge; length,
output detail and thinking change actual usage. Free-tier
quotas may be too low for long videos.

Gemini is the recommended starting point for complex transcripts, based on its
documented capabilities and cost. Its authenticated transcript quality and latency
have not yet been benchmarked in this app. GPT-6 Luna is a cheaper preset to compare;
Claude Sonnet 5 is a more expensive alternative. Existing explicit video choices
are preserved. A legacy model-only override keeps its original endpoint but now
requires a dedicated video key. Small/local models may struggle with structured
analysis. Providers can also decline content: Alibaba/Qwen blocked the political
interview excerpt during testing, which may affect optional Chinese translation.

- Desktop watch pages at `www.youtube.com/watch` with available captions. Live streams,
  Shorts, visual-only demonstrations, and fresh speech transcription are not included.
- The collector first attempts the caption track exposed by the player. On pages
  with YouTube's newer **In this video → Transcript** layout, it also requests the
  complete transcript payload used by that panel, through YouTube's same-origin
  endpoint and the command supplied for the current video. This supports its
  chapter-grouped caption format and hour timestamps without waiting for every
  visual row to render. It accepts only the dedicated transcript body, checks the
  video IDs, and rejects payloads with pending pages. Blank cues in either caption
  format are skipped; invalid timestamps and unreadable text still fail. The new payload
  does not always identify its language or automatic-caption status; in that case the UI
  says **YouTube selected track** instead of guessing.
  If needed, it loads YouTube’s native transcript UI, supporting both panel layouts.
  It reads the complete caption body from the list,
  its controller, or the parent transcript data, including rows outside the visible
  area. Search results are rejected. Language/search controls are not treated as
  pending caption pages. When pagination is present, it advances the actual scroll
  viewport and retains captions across replaced pages. It allows up to three minutes
  while pages make progress, stopping after 20 seconds without new captions (45
  seconds for the first rows). The caption body must settle without pending pages
  or active loading before analysis. This is a completeness check on the
  data exposed by YouTube, not proof that the captions capture every spoken word.
- Captions may contain transcription mistakes or untranslated visual information.
  Names, numbers and speaker identity can be ambiguous. Source excerpts help inspect
  the generated claims; valid citation IDs do not prove semantic accuracy.
- The complete transcript is sent in one model request. The response contains a
  thorough summary and up to eight grouped themes with reasoning, examples,
  qualifications and timestamp citations. The summary appears first; the breakdown
  is collapsed until opened. There are no automatic extraction, audit or synthesis
  passes. A model can still omit or misinterpret a point; valid citation IDs do not
  prove that the summary accurately represents the source.
- Transcripts over 600,000 characters, 20,000 segments, or 12 hours are rejected
  explicitly rather than silently truncated. Source collection depends on YouTube’s
  frontend and may need maintenance when that frontend changes.
- The selected model must accept the complete transcript within its context window.
  An oversized provider request is reported as an error; captions are never silently
  dropped. Follow-up evidence lookup and optional translation use bounded batches.
  Large responses are transferred in multiple browser messages, and cached results
  avoid repeat model calls. Azure video requests use the configured reasoning effort.

## Data and permissions

The extension can read the YouTube watch page, open its own side panel, store the
current tab selection for the browser session, and connect to its named native host.
The native host allows only the companion’s fixed extension ID.

API keys stay in EasyUnderstand’s existing OS-encrypted store. A saved video key is
bound to its endpoint; changing that endpoint requires saving its key again. There
is no automatic fallback to the everyday API key. The caption text and your questions
are sent to the video provider. On request, the existing English analysis is sent
to the everyday provider for Chinese translation. Model responses are
rendered as text, never injected HTML. Transcript text is untrusted model input.

English and Chinese analyses are saved under `video-cache` in EasyUnderstand’s data
folder, keyed by transcript content, provider endpoint, model, language and prompt
version; Azure entries also include reasoning effort. Chinese entries also include the translation model/endpoint and the English
analysis they translate, so model changes cannot return stale translations. The
cache retains entries for **7 days after saving**, with at most **30 saved analyses
total** (English and Chinese entries count separately). The oldest entries are
removed first; opening a summary does not extend its expiry. Expired entries are
never reused. Cleanup runs on desktop startup, hourly while the desktop app runs,
and on video-helper requests and cache writes, so older existing files are cleaned
on the next use as well. Raw transcript text is held in
the panel/worker for the session; it is not saved in that cache. Use the desktop tray’s
**Open data folder** action to inspect or delete cached analyses.

## Troubleshooting and checks

- **No handler registered for `config:video-test` / update restart notice:** the
  Settings window loaded new files while the old background app kept running.
  Use the tray icon → **Quit EasyUnderstand**, then reopen it. Closing the Settings
  window or launching the shortcut again does not restart an existing instance.
  Saved API keys are preserved. Settings now detects this mismatch before allowing
  model tests or edits.
- **Could not connect:** run `npm run setup:youtube`, reload the extension, and retry.
  Moving the checkout or removing Node/Electron requires registering it again.
- **Understand video seems to do nothing:** the button now shows **Opening
  EasyUnderstand…** until the browser confirms the side panel opened and the request
  was saved. An opening failure or missing response shows a retry or reconnect
  message below the video; try again or use the extension's browser toolbar icon.
  Delayed YouTube title updates also preserve the pending start request. Rebuild and
  reload the extension, then refresh existing YouTube tabs to receive these fixes.
- **Extension context invalidated / error in content.js after reloading:** refresh
  the existing YouTube tab once. Reloading the extension invalidates the script
  already attached to that page. The updated button catches both immediate throws
  and rejected messages, then changes to **Reload YouTube to reconnect**; clicking
  that label refreshes the tab. An old script already on a page needs that first
  manual refresh to receive this fix.
- **No transcript:** check YouTube’s native **Show transcript** availability. If it
  loads but capture fails, report the error and video URL. The description is never
  substituted as the summary source.
- **Complete transcript could not be confirmed:** the error reports whether YouTube
  exposed no caption rows, remained loading, or stalled on another page, with the
  number of collected captions and last timestamp when available. Clear any search
  inside YouTube's transcript panel; if it shows an error, use its Retry button.
  Then click Understand video again. No model request is made with partial captions.
  If a previous version captured zero rows despite a working **In this video →
  Transcript** panel, rebuild and reload the extension, then refresh YouTube to
  activate support for that newer layout.
- **Model error:** verify your provider/key in EasyUnderstand Settings and use a model
  that supports sufficiently long input and structured JSON. Invalid summaries and
  evidence references are surfaced as errors so you can retry explicitly. Follow-up
  and translation responses may receive one format correction. The panel
  shows source quotes on demand, with three timestamps initially per theme;
  expand to inspect the remaining references.
- **Timed out connecting to the model provider:** this means connection setup
  failed (`UND_ERR_CONNECT_TIMEOUT`), before an HTTP response. It does not show
  how long the model needed to summarize. Retry once; recurring failures call for
  checking the endpoint, network, or proxy. Response-header and response-stream
  timeouts are reported separately when the transport supplies that detail.
  A generic timeout means no more specific cause was available. The app does not
  silently retry a failed summary or shorten its transcript.
- **Cancel:** stops model work through connection shutdown. An already-running page
  transcript read may finish in the background, but its result is discarded.

```powershell
npm run build
npm test
npm run verify:youtube
```

`verify:youtube` exercises the built caption collector against controlled page
fixtures and the actual native launcher → Electron connection. It does not claim a
successful run in an authenticated Chrome/Edge session. Live YouTube verification
requires loading the unpacked extension in the browser.

To explicitly make one fresh model request through the installed native helper
using a previously captured complete transcript (uses the saved video API key):

```powershell
node scripts/verify-video-model.mjs --live --transcript out/diagnostics/dhh-captured-transcript.json --fresh --quiet
```

The helper validates the transcript, summary, and citation IDs. This reports model
and native-helper elapsed time; it excludes browser opening, caption collection,
and display. The result is saved in `out/verification/live-transcript-analysis.json`.

Implementation references:
[Chrome side panels](https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Edge sidebar](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/sidebar).
