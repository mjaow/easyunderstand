# EasyUnderstand

**Understand words, code, and videos.**

EasyUnderstand (formerly EasyTranslate) is a desktop companion for understanding
what you read and watch.
Explain selected text and code without leaving your app, or turn a YouTube
transcript into a clear account of the speaker's argument, reasoning, and evidence.
English and Chinese explanations, pronunciation, and read-aloud help you learn
along the way.

| What you want to understand | What you get |
|---|---|
| Words and passages | Plain English and Chinese explanations, common or contextual meanings, examples, dictionary pronunciation, and read-aloud. |
| Your writing | Clearer spelling, grammar, wording, structure, and flow in the original language. |
| Code | Its purpose, step-by-step reasoning, design choices, and possible bugs or edge cases in the selected snippet. |
| YouTube videos | The core argument and takeaways first, concise breakdowns with timestamp sources, and a separate assessment of the evidence and reasoning. |

**Windows 10/11 and macOS 13+.** Full-video analysis uses an optional Chrome/Edge
extension; Windows is the verified platform for that companion.

## See it in action

Real usage screenshots: [plain text](#translate-plain-text),
[YouTube captions and transcripts](#translate-youtube-captions-and-transcript-lines),
[Understand video](#understand-a-whole-youtube-video), and
[YouTube Ask side by side](#compare-with-youtubes-ask-feature).

### Translate plain text

1. [Install and configure the desktop app](#getting-started), then keep it running
   in the system tray or menu bar.
2. Select a word or passage in your browser, editor, PDF reader, or another app.
3. Press **`Ctrl+Alt+E`** on Windows or **`⌘⌥E`** on macOS.

For passages, the popup gives you a Chinese translation, an **In plain English** explanation,
and **Words worth knowing** with meanings, examples, and pronunciation when
available. Use the speaker buttons to listen, or the turtle button for slower
speech. If you select code, the popup offers to explain what it does.

![Selected text in a Wall Street Journal post on X, with an EasyUnderstand popup showing Chinese translation, plain English, and vocabulary.](docs/images/plain-text-translation.png)

*Translate a passage where you are reading it. The popup keeps the original text,
translation, and vocabulary together.*

The selection popup does not take focus, and text capture restores your clipboard.
See [How it works](#how-it-works) for the supported capture paths and their limits.

### Refine writing in the same language

Select text in an **editable textbox** (a draft email, chat, or document) or
**read-only content**, then press **`Ctrl+Alt+R`** on Windows or **`⌘⌥R`** on macOS.
The popup improves spelling, grammar, word choice, sentence structure, and logical
flow while keeping your meaning. English stays English; Chinese stays Chinese,
including Simplified or Traditional characters. Mixed-language text keeps its languages.

Click **Copy refined text**, then paste it into any editable field. The source text
stays in place and capture restores your clipboard. Refinement uses your existing
**Explanations** model and key. Change either shortcut under **Settings → Hotkeys**;
if a shortcut is taken, the app chooses and saves an available alternative.

Cloud refinement automatically retries once if no text arrives for five seconds
or a response stops progressing for five seconds. It shows **Connection is slow.
Retrying…** and keeps the original selection. Azure desktop lookups use Electron’s
browser networking, and Copy becomes available as soon as Azure confirms completion.
The recovery request can incur an additional API charge; no new setting is needed.

### Translate YouTube captions and transcript lines

With the desktop app running, use either of these gestures:

- **On-screen captions:** turn on YouTube's **CC**, then double-click the caption
  text itself to explain the current passage. Clicking the video background can
  trigger YouTube's fullscreen toggle.
- **Transcript panel:** open YouTube's **Show transcript** (or the **Transcript**
  tab under **In this video**), then double-click a transcript line. You can also
  select transcript text and press **`Ctrl+Alt+E`** (**`⌘⌥E`** on macOS).

The popup shows the Chinese translation, simpler English, and vocabulary for that
passage. Double-click translation can be turned on or off in **Settings**; it uses
the desktop app and does not require the full-video companion extension. Text comes
only from the page's captions or transcript. If neither is available, the click
produces no popup; video frames and images are never read with OCR.

![A YouTube caption translated in an EasyUnderstand popup over the video, with Chinese, plain English, and explanations of ridicule and rational.](docs/images/youtube-caption-translation.png)

*The caption “to the point of ridicule, and what is the rational reaction for”
becomes a bilingual explanation with vocabulary you can listen to.*

### Understand a whole YouTube video

1. [Set up the optional Chrome/Edge companion](docs/YouTube.md#install-the-personal-version)
   and configure its video model and API key in **Settings → YouTube analysis**.
2. Open a YouTube video with an available caption transcript. Click
   **Understand video** below the video, or the companion's browser toolbar icon.
3. Read the **Summary** and **Key takeaways** in the side panel. Open
   **Explore the breakdown** for the speaker's reasoning, examples, and qualifications.
   Click timestamp sources to jump to the supporting moments.
4. Ask follow-up questions below the analysis, choose **Translate to Chinese**,
   or use **Copy summary + breakdown** to take the analysis with you.

For a separate viewing guide, click **Plan watch** beside **Understand video** on
YouTube. Each button opens its own dedicated sidebar view and starts immediately;
there is no second start click inside the panel. Planning collects the video directly, infers its learning
purpose from the title and description, and uses the complete transcript to label
**Focus**, **Skim**, **Skip**, and **Check visuals** sections. No summary or setup
form is required. Click a timestamp or **Next focus section** to navigate. Planning
uses the same video model and key, including an existing Azure OpenAI GPT-6 Luna
deployment.

![YouTube with the Understand video button below the player and an arrow pointing to the EasyUnderstand summary in the browser side panel.](docs/images/youtube-understand-video-masked.png)

*One click opens an analysis of the complete caption transcript. The panel also
shows the caption language, transcript size, model, processing time, and cache usage.*

The summary and breakdown are generated together in one request. When relevant,
**Critical assessment** separately examines the support, gaps, and possible checks
for substantive claims. It evaluates the transcript's reasoning without independently
verifying external facts. Saved summaries expire after 7 days, with at most 30
entries; **Summarize again** requests a fresh analysis and **Clear cache** removes
saved video results.

### Compare with YouTube's Ask feature

You can keep YouTube's **Ask** panel and EasyUnderstand open together. This
screenshot shows both summarizing the same DHH interview: YouTube's **Ask about
this video** on the left and EasyUnderstand on the right.

![Side-by-side summaries of the same interview: YouTube Ask on the left and EasyUnderstand's summary and timestamped key takeaways on the right.](docs/images/youtube-ask-comparison-masked.png)

| In this screenshot | YouTube Ask (left) | EasyUnderstand (right) |
|---|---|---|
| Starting point | A “Summarize the video” prompt in a conversation. | A dedicated Summary followed by Key takeaways. |
| Reading layout | A response organized around key themes, with a question box below. | A separate side panel with an overview and individual takeaways. |
| Source navigation | Inline timestamp links in the response. | Timestamp buttons beneath the relevant takeaways. |

For more depth in EasyUnderstand, scroll to the breakdown and critical assessment,
ask a follow-up, or translate the analysis to Chinese.

Use your own model API keys, including Azure OpenAI deployments. Video analysis
has its own model and encrypted key; everyday explanations and optional Chinese
translation use separate settings. Code explanations can use their own model too.

---

## Getting started

### Windows

Open PowerShell and paste one line:

```powershell
irm https://raw.githubusercontent.com/mjaow/easytranslate/main/install.ps1 | iex
```

It installs Node.js if you don't have it, downloads and builds the app into
`%LOCALAPPDATA%\EasyTranslate`, adds **EasyUnderstand** to the Start menu and desktop,
and starts it. The first run takes a few minutes; Settings opens by itself so you can
paste a key. Run the same line again any time to update.

Existing installations keep their settings, encrypted keys, and data in the
original `easytranslate` folder. Older EasyTranslate launch shortcuts still work;
updated shortcut setup assigns the launch hotkey to EasyUnderstand.

Press **`Ctrl+Alt+T`** to start EasyUnderstand later, without opening a terminal. If it
is already running, this opens Settings. Keep the desktop shortcut: Windows uses it
for this launch key. **`Ctrl+Alt+E`** explains selected text once the app is running.
To change the launch key, right-click the desktop shortcut → **Properties → Shortcut
key → Apply**. Running the installer or shortcut setup again restores `Ctrl+Alt+T`.

The app lives in the **system tray**: a two-tone circle near the clock, under the `^`
if Windows has hidden it. There is no main window.

### macOS

Open Terminal and paste one line:

```bash
curl -fsSL https://raw.githubusercontent.com/mjaow/easytranslate/main/install.sh | bash
```

Same idea: Node.js if it is missing, the app built into `~/.easytranslate`,
**EasyUnderstand** in `~/Applications` so Spotlight finds it, and it starts.

Then do the one thing no installer can do for you:

> **System Settings → Privacy & Security → Accessibility → switch on Electron**, then
> quit EasyUnderstand and start it again.

macOS will not let *any* app read your selection until you allow it, and it only checks
at launch — so the restart matters. EasyUnderstand says so on first run and offers to
open the right page. (The switch is labelled **Electron**, not EasyUnderstand, because
an installed-from-source build runs on Electron's own binary.)

The app lives in the **menu bar**, near the clock. There is no dock icon and no main
window.

On either platform, start it later from the Start menu or Spotlight, or turn on
**Start EasyUnderstand when I log in** in Settings and forget about it.

<details>
<summary>From source, for development</summary>

```bash
git clone https://github.com/mjaow/easytranslate.git
cd easytranslate
npm install
npm start        # builds and launches
npm run dev      # hot reload
```

On Windows, run this once to build the app and add Start menu and desktop shortcuts
for this checkout:

```bash
npm run setup:shortcuts
```

Then press `Ctrl+Alt+T` to launch it. The shortcuts use the existing build, so after
changing source code run `npm run build` and restart the app. If you move the checkout,
run `npm run setup:shortcuts` again to update the shortcut paths.

For a source build on macOS, grant Accessibility to the Electron binary
under `node_modules/electron/dist` — dragging it into the Accessibility list from Finder
is the quickest way — or every capture will silently read nothing.

</details>

### Configure it

Right-click the tray icon → **Settings…**

1. **Explanations** → *Quick setup* → pick a backend → paste its API key → **Save**.
   **Gemini Flash-Lite** is a good first choice: free, fast, good at Chinese. The link
   under the picker opens the page where you get a key.
2. **Read aloud** → paste an Azure Speech key and region for the natural voice, or
   switch to the free offline system voice — SAPI on Windows, `say` on macOS.
   **🔊 Test voice** reports which engine actually produced the sound.

Settings opens by itself the first time, since nothing works until step 1 is done.

---

## Using it

| Gesture | Result |
|---|---|
| Select text, press `Ctrl+Alt+E` (`⌘⌥E`) | Explain the selection |
| Select text, press `Ctrl+Alt+R` (`⌘⌥R`) | Refine writing in its original language |
| Double-click a YouTube caption exposed by the page | Explain the current caption |
| Double-click a line in the YouTube transcript panel | Explain that line |
| `Esc`, or the shortcut again | Close the popup |
| Select any words in the popup | Copies them — selecting *is* the copy |
| Click **Copy refined text** | Copy the complete refinement, ready to paste |

- **Three words or fewer** are treated as a term: dictionary IPA when available,
  part of speech, common meanings when selected alone or the relevant meaning when
  surrounding context is available, and an example.
- **Anything longer** is treated as a passage: natural Chinese, simpler English, and
  the hard words and idioms in it, each with dictionary IPA when available, Chinese
  and an example.
- **Code** gets an offer: when the model judges the selection to be source code, the
  popup shows **This looks like code — explain what it does**. One click gives a code
  review rather than a paraphrase: what it does, what problem it solves and why this
  approach, a step-by-step walk through it, why it is written the way it is, any bugs
  or edge cases visible in the snippet, and the concepts worth knowing. Any language,
  a shell command, a query or a JSON fragment all count; a sentence that merely
  mentions `C++` does not. Settings can point code explanations at a stronger model
  than everyday lookups use, since design and bug reasoning is where that pays off.
- **🔊** reads it aloud, **🐢** reads it slowly, **⏹** stops.
- **Drag across anything in the popup to copy it.** Double-click a word, or sweep a
  phrase; it goes on the clipboard when you let go. Refinement also has a **Copy
  refined text** button. **Try another version** requests different wording from
  the original selection, keeping its meaning and language. No configuration is
  needed; each click requests a fresh result. A failed retry keeps the previous
  complete version available. Every copy shows **Copying…**, then **Copied to clipboard**
  or **Copy failed**. The result stays visible at the bottom while you scroll, until
  the next copy, lookup, or close. No copy shortcut is needed — see
  [How it works](#how-it-works).

The double-click needs no shortcut. Words come only from captions or transcript
lines exposed by the page's accessibility tree. Text baked into a video frame or
image is ignored, including on X. Missing captions produce no popup. YouTube treats a
double-click on the video as its fullscreen toggle, so double-click the caption text
itself to avoid that. The double-click can be turned off in Settings.

### Pronunciation

IPA (International Phonetic Alphabet) comes from a bundled **American English
pronunciation dictionary**, based on CMU's dictionary via
[ipa-dict](https://github.com/open-dict-data/ipa-dict). It works offline without an
extra API key. For example, **debit** is **/ˈdɛbɪt/** (DEB-it).

For a word with multiple pronunciations, such as **read**, the explanation model can
select an exact dictionary candidate when the selected passage or supplied sentence
provides context. Otherwise the alternatives are shown with **or**. Dictionary
candidates prevent invented IPA, but a model can still select the wrong valid
variant. Words and phrases without an entry have no IPA; their explanations and
read-aloud still work. Existing answers with model-generated IPA are refreshed on
the next lookup after this update.

The speaker button reads the original text using your configured voice, separately
from the displayed IPA. Changing pronunciation data does not change your explanation
model, translation quality, or speech provider.

### Changing the shortcut

In Settings, **press the keys you want**; the chord is recorded, not typed. If the
shortcut is already owned by another app, EasyUnderstand binds the next free one and
tells you which. To see which combinations are free on your machine, quit the app
first (it holds its own shortcuts) and run:

```bash
npm run probe:hotkeys
```

`Ctrl+Alt+Space` is taken on any machine with a Chinese or Japanese IME. On macOS the
probe offers Command combinations rather than Control ones, because Control+Option is
where macOS keeps its own shortcuts and a bare `⌥`+letter is the dead key for typing an
accented character.

---

## Providers

Swappable in Settings. **Quick setup** sets provider, model and base URL together;
**Test connection** makes a real request and, if the model is refused, lists the model
ids that key can actually call. Groq and Gemini speak the OpenAI protocol, so the
`openai` provider reaches them with a different base URL and model.

| Preset | Cost at ~100 lookups/day | Notes |
|---|---|---|
| Azure GPT-6 Luna | Azure deployment pricing | Translation and code explanations through the Responses API |
| **Qwen Flash** | **~$0.07/month** | Alibaba's own model: cheapest, most idiomatic Chinese |
| Gemini Flash-Lite | free tier | Best Chinese of the free options |
| Groq | free tier | Fastest; Llama is the weakest here at Chinese |
| **Claude Haiku 4.5** | **~$3/month** | Idiomatic Chinese, consistent section formatting |
| Claude Sonnet 5 | ~$5/month | Sharper on slang and register |
| OpenAI nano | ~$0.20/month | Cheap; weaker on subtle Chinese wording |
| Ollama | free | Offline and private; ~11s per lookup on a CPU-only machine |

Base-URL conventions differ: the Anthropic SDK appends `/v1/messages` itself, while the
OpenAI SDK appends `/chat/completions`, so an OpenAI-style base URL must already end in
`/v1`.

For **Azure OpenAI — GPT-6 Luna**, enter your deployment name and the full endpoint
ending in `/openai/responses?api-version=…`, then save the Azure resource key.
This provider uses Azure `api-key` authentication and reasoning effort `none`.
The desktop app prepares an Azure connection at startup, when settings change, and
every 30 seconds while running, without sending a prompt or making a model request.
Short text requests use the standard output allowance without extra reasoning-token
headroom; code and selections of 1,000 characters or more keep the larger allowance.
Set **Model for code explanations** to the deployment name too, or leave it empty
to use the everyday model. Its encrypted Azure key is separate from OpenAI-compatible
providers and YouTube analysis. **Test connection** checks the configured deployments;
Azure failures do not attempt a public model listing.

### Voices

- **Natural voice (Azure)**: neural voices over plain HTTPS. Free for 500k characters a
  month, far more than reading uses. Needs a Speech resource key and its region.
- **System voice**: free, offline, instant, noticeably robotic — SAPI on Windows,
  `say` on macOS. The automatic fallback when the online voice fails. On a Mac set up
  in another language it uses Samantha rather than the system default, since hearing
  American English is the point.

The read-aloud key has its own slot, because the `openai` LLM slot often holds a Gemini
or Groq key that a speech API would reject.

---

## Security

Selected text comes from whatever page you were reading, so it is treated as untrusted
throughout.

- **Renderers are sandboxed**, with context isolation on and node integration off. The
  only bridge is a small typed surface in `src/preload`.
- **Model output is rendered as text, never HTML.** No `innerHTML`, no `eval`.
- **The app's own windows cannot navigate**, `<webview>` is refused, external links must be `http:`
  or `https:`, and each page carries a Content-Security-Policy.
- **Selected text never reaches a shell or a parser unescaped.** The offline voice gets
  it through a file on both platforms — PowerShell reads the file, `say -f` reads the
  file — and Azure gets it XML-escaped. Covered by tests.
- **API keys are encrypted at rest** through Electron `safeStorage`: Windows DPAPI, and
  the login Keychain on macOS. Either way the ciphertext is bound to the user account
  and useless if the file is copied elsewhere. If the OS cannot encrypt, the app
  refuses to store the key rather than writing plaintext. `ANTHROPIC_API_KEY` and
  `OPENAI_API_KEY` environment variables take precedence.
- **Video frames and images are never read with OCR.** Double-click translation
  uses only caption or transcript text exposed by the page. Missing text does not
  trigger screen capture or image recognition.
- **Nothing is sent anywhere except the provider you configure.** No telemetry.
- `npm audit --omit=dev` reports 0 vulnerabilities.

A page could word its content to influence what the model says about it. The output
cannot execute, but treat an explanation as what a model made of a web page, not as
fact.

---

## Known limits

**Both platforms**

- **A shortcut owned by another process does nothing when pressed.** `probe:hotkeys`
  catches conflicts registered the normal way; an app that grabs keys first with a
  low-level hook or a `CGEventTap` (some IMEs and vendor utilities) can still swallow
  the key. If a combination probes free yet never fires, pick another.
- **DRM'd text and text baked into images can't be captured.** There is nothing for
  the copy to copy.
- **Double-click-to-explain requires accessible caption or transcript text.** A
  double-click is only examined when a window titled "YouTube" or "… / X" is in front.
  Captions baked into the picture are unsupported. If a caption or line ever
  fails to register, `last-click.log` in the data folder (tray → *Open data folder*)
  records what the accessibility tree reported.

**Windows**

- **Apps running as administrator ignore the hotkey.** Windows blocks synthetic input
  from a lower-integrity process, and no unelevated app can work around it.

**macOS**

- **Nothing works until Accessibility is granted**, and macOS reads that grant only
  when the app launches — so switching it on while EasyUnderstand is running does
  nothing until you quit and start it again. The app checks at startup and says so
  rather than letting every press fail in silence.
- **The switch is labelled "Electron"** for an installed-from-source build, because
  that is the binary the OS sees. A packaged `.app` from `npm run dist:mac` appears
  under its own name.
- **Secure input fields block the copy.** While a password field has focus — or any
  app has turned on secure event input — macOS refuses synthetic keystrokes from
  everyone. This is the macOS counterpart of the elevated-window rule above.

### If Electron fails to start

On some Windows machines Electron's installer downloads its zip correctly but the
extraction stalls after the first entry, leaving no `electron.exe`; usually security
software inspecting large archive writes. `npm run fix:electron` re-extracts from the
cached zip with the platform unzip. It also runs as a `postinstall` step, and is a
no-op when Electron is healthy and on macOS, which has never shown the problem.

---

## Verification

```bash
npm test               # unit tests: parser, prompts, SSML escaping, CSP, transcript rules
npm run verify:capture # end-to-end capture: reads the selection, restores the clipboard exactly
npm run verify:hotkeys # clipboard shortcuts refused, conflicts fall back, availability check is honest
npm run verify:click   # real OS double-clicks on a YouTube-shaped page come back as the right lines
npm run verify:code    # asks the configured model: snippets come back as code, prose as prose
npm run verify:refine  # asks the configured model: English, Chinese, and mixed-language editing
npm run probe:hotkeys  # which shortcuts are free on this machine
```

Every one of these runs on both platforms and exercises that platform's own layer —
`verify:capture` posts a real `Ctrl+C` or `⌘C`, `verify:click` sends real OS mouse
clicks and reads the real accessibility tree, `verify:code` asks the configured model.

`verify:capture` may need you to **click its test window** when it appears: Windows
will not let a terminal-launched app focus itself at all, and macOS occasionally loses
the race with whatever was already frontmost. `verify:hotkeys` needs the app quit first.

Manual matrix, for each app: select text → hotkey → the right text was captured, your
own paste still gives your original clipboard, the selection is still highlighted.
Windows: Edge · Chrome · ChatGPT desktop app · Teams · Edge PDF viewer · VS Code ·
Notepad. macOS: Safari · Chrome · Preview · Notes · VS Code · Terminal.

---

## How it works

```
  select text anywhere             your normal selection; EasyUnderstand is not involved
            ↓
  press the hotkey                 global, Ctrl+Alt+E or ⌘⌥E
            ↓
  snapshot the clipboard           every format, as-is
  note the OS change counter
            ↓
  synthesise a clean copy          held modifiers released first
            ↓
  poll the change counter          every 10ms, up to 700ms; one retry if nothing landed
            ↓
  read the copied text, restore your original clipboard
            ↓
  non-activating popup at the cursor, explanation streamed in
```

Two operating systems, the same seven steps. Only the middle three are native, and
each platform does them its own way:

| | Windows | macOS |
|---|---|---|
| change counter | `GetClipboardSequenceNumber` | `NSPasteboard.changeCount` |
| synthetic copy | `SendInput` → Ctrl+C | `CGEventPost` → ⌘C |
| never take focus | `WS_EX_NOACTIVATE` on the HWND | `canBecomeKeyWindow == NO`, app hidden from the dock |
| pointer + button | `GetCursorPos`, `GetAsyncKeyState` | `CGEventGetLocation`, `CGEventSourceButtonState` |
| window in front | `GetWindowTextW` | `AXFocusedWindow` → `AXTitle` |
| tree under a point | UI Automation, via PowerShell | Accessibility API, in process |
| offline voice | SAPI (`System.Speech`) | `say` |
| key storage | DPAPI | login Keychain |

Everything above that table — providers, prompts, the streaming parser, the popup and
settings UIs, the transcript and caption rules — is one implementation, shared.

**Why the selection translator is a desktop app.** A click-to-translate extension can inject
DOM next to your selection, and that overlay collapses the selection so your own Ctrl+C
grabs nothing. It also only lives in one browser. Running outside every app, driven by a
global hotkey, is what makes "works everywhere" and "never touches your selection"
both free.

**The copy-safety contract.** Testable rules the implementation holds to:

1. The desktop selection translator uses no content scripts, injected DOM or page
   listeners. The optional YouTube companion separately adds its own button and
   reads caption data, without borrowing the clipboard or handling selection clicks.
2. A capture always restores the clipboard, every format, typically within ~150ms.
   Selecting text in the popup or clicking **Copy refined text** explicitly replaces
   the clipboard with that text and leaves it written.
3. The popup never takes focus, and that is checked rather than assumed. Electron's
   `focusable: false` is
   [unreliable on Windows](https://github.com/electron/electron/issues/11049), so there
   the popup also has `WS_EX_NOACTIVATE` stamped onto its window handle, and the style
   is read back. On macOS `focusable: false` *is* the mechanism — it makes the window
   refuse to become key — so what is read back is `canBecomeKeyWindow`, on the real
   `NSWindow`, at the moment the popup is first ready. (`type: 'panel'` and the
   non-activating panel style would be the tidier answer, but as of Electron 44 the
   window it builds is a plain `NSWindow`, AppKit refuses the style, and the window
   then never becomes ready to show at all.) The other half of the macOS guarantee is
   not a window flag: hiding the app from the dock makes it an accessory application,
   and an accessory application does not come forward when one of its windows appears.
4. The platform's copy, paste and cut chords can never be bound, whatever the config
   says — Ctrl+C/V/X and ⌘C/V/X alike, since a config recorded on one platform can be
   read on the other.

**Why selecting in the popup is itself the copy.** Rule 3 closes the ordinary route: a
window that never takes focus never receives a keystroke either, so ⌘C pressed over the
popup reaches whatever app *does* have focus — and binding the copy chord so it arrives
here instead is exactly what rule 4 forbids. A drag, though, needs no focus at all: a
window that cannot become key still tracks the mouse and still renders a selection,
which is checked with a real `CGEventPost` drag over the real popup. So the selection is
the gesture. On mouse-up the renderer hands what was selected to the main process, which
writes it; the highlight is drawn in the accent colour rather than the system's
washed-out inactive grey, and the popup names what it took, because silently replacing
someone's clipboard is no way to behave.

**Why the clipboard change counter.** A fixed sleep is slower than needed on fast apps
and unreliable on slow ones, and cannot tell "this app is slow" from "this app ignored
the copy". Watching the counter the OS bumps on every clipboard write does both, and
both platforms keep one. Measured round trip: 23ms on Windows; on macOS about 100ms
for the first lookup after launch and ~30ms once warm, the difference being the first
touch of the Objective-C runtime.

`verify:capture` checks this twice — once normally, and once with the hotkey's own
modifiers physically held down, which is the case the release-then-copy dance exists
for and the one a plain call would never exercise.

**The YouTube double-click.** The mouse button is polled, nothing is hooked. A
double-click on a YouTube window is looked up in the page's accessibility tree: a
transcript line is a button named with its spoken time, and a caption is a
`caption-window` element inside the player. If the page exposes neither, the click
is ignored. The app never extracts text from the video picture or falls back to OCR.

The two trees do not look alike, and that is the one place the platforms genuinely
differ rather than merely spell things differently. UI Automation hands back Chromium's
HTML `class` attribute as the element's class name, so `caption-window` matches
directly. The macOS tree has no class name: an element arrives as a role (`AXButton`,
`AXStaticText`, `AXGroup`) with a title, a description and a DOM id, so the same
caption is recognised from `AXDOMIdentifier` and `AXDOMClassList` instead. Both walks
end in the same `PointRead`, and one set of rules
(`src/core/transcript.ts`) decides from it whether that was a transcript line — which
is what keeps the feature's behaviour identical rather than merely similar. macOS also
gets the answer far quicker: the Accessibility API is plain C, so the read happens in
process in about 4ms, where Windows pays a PowerShell start-up of roughly a second.

Polling differs for one honest reason. `GetAsyncKeyState` records a press that fell
entirely between two polls, so Windows can poll every 15ms and still never miss a
click. `CGEventSourceButtonState` has no such bit, so macOS polls every 8ms instead —
a human press-and-release is 30ms at its very fastest, and 8ms of a microsecond call
is still invisible.

**Streaming.** The model answers in fixed `## SECTION` blocks rather than JSON, so the
popup fills in top-down as tokens land. The parser is tested against chunk sizes from
one byte upward.

**Code.** No pattern decides whether a selection is code. The ordinary answer opens
with a one-word verdict from the model (`## CODE`, yes or no); a yes makes the popup
offer to explain it, and the click is a second request with the dedicated code prompt
(`LANG`, `STEPS`, `CONCEPTS`). The selection reaches the model fenced, with its line
breaks and indentation kept. `verify:code` checks both steps against the configured
model with a mix of snippets and prose that mentions code.

---

## Layout

```
src/
├─ main/           app lifecycle, tray, hotkeys, capture, popup, click watcher
│  ├─ native/      the platform layer — the only OS-specific code in the app
│  │  ├─ types.ts    what a backend must do, and what each call means
│  │  ├─ index.ts    picks one at startup; a platform with no backend gets no-ops
│  │  ├─ win32.ts    koffi bindings: SendInput, clipboard sequence, cursor, window styles
│  │  ├─ macos.ts    koffi bindings: CGEventPost, NSPasteboard.changeCount, cursor, focus
│  │  ├─ objc.ts     just enough Objective-C runtime to reach what has no C surface
│  │  └─ ax.ts       the macOS Accessibility API
│  ├─ capture.ts   snapshot → copy → poll → read → restore
│  ├─ clicks.ts    double-click detection by polling the mouse button
│  ├─ coords.ts    physical screen pixels ↔ Electron's device-independent ones
│  ├─ a11y.ts      what the accessibility tree holds under a point, either platform
│  ├─ a11y-macos.ts  the macOS walk (Windows uses a PowerShell script in resources/)
│  ├─ popup.ts     the non-activating window
│  └─ verify*.ts   self-tests, loaded only behind their CLI flags
├─ core/           mode detection, prompts, streaming parser, transcript and tree rules, cache, config
├─ providers/      llm/{claude,openai,ollama}   tts/{azure,system}
├─ renderer/       popup UI and settings UI
└─ shared/         types used across all three processes

resources/
└─ transcript-at-point.ps1   the Windows accessibility read
```

## Platform support

Windows 10/11 and macOS 13+, from the same source tree.

`src/main/native/` is where the difference lives. Outside it, the code that still has
to know is small and named: `coords.ts` (one unit conversion Windows needs and macOS
does not), `a11y.ts` and `a11y-macos.ts` (the platform accessibility readers), the
offline half of `providers/tts/system.ts`, the hotkey candidate lists, and the handful
of sentences in Settings that name a key or a System Settings pane. Everything else —
the capture algorithm, the click watcher, the transcript and caption rules, providers,
prompts, the streaming parser, both UIs — is one implementation. Adding a third
platform means writing one more backend against `native/types.ts`, not another fork of
the app.

Neither backend needs a compiler. Both go through [koffi](https://koffi.dev), which
ships prebuilt binaries, so there is no node-gyp step, no Visual Studio Build Tools and
no Xcode. Shortcuts are stored in a portable form (`CommandOrControl+Alt+E`), so a
config written on one platform is already correct on the other.

The honest asymmetries:

- **macOS asks permission; Windows does not.** Synthetic input and the accessibility
  read need Accessibility permission. The app checks and reports it at launch, so
  granting it takes a restart. Screen Recording is not needed.
- **Windows shells out where macOS does not.** The accessibility read uses a
  PowerShell script on Windows because UI Automation is .NET; on macOS the
  Accessibility API is C, so the read runs in process.
- **`type: 'panel'` is not usable.** The natural macOS home for a non-activating popup
  is an `NSPanel`, and Electron 44 does not actually produce one. What the popup relies
  on instead is described under [How it works](#how-it-works), and it is verified at
  runtime rather than assumed.
