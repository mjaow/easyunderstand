/** Exercise language preservation with the user's configured everyday model. */
import { app, net } from 'electron'
import { loadConfig, getSecret } from '../core/config.js'
import { RefinementParser } from '../core/refine.js'
import { streamRefinement } from '../core/refine-generation.js'
import { createLlmProvider, describeError } from '../providers/llm/registry.js'

const CASES = [
  {
    label: 'English spelling and grammar',
    text: 'i has recieve your mesage, we needs finish the report by Friday but i am not sure if we has enough datas.',
    valid: (text: string) => !/[\u3400-\u9fff]/.test(text) && /Friday/.test(text) &&
      !/\b(?:recieve|mesage|datas)\b/i.test(text) && /(?:not sure|unsure|uncertain)/i.test(text)
  },
  {
    label: 'Simplified Chinese structure',
    text: '因为这个问题我们讨论了很久然后但是还是没有结果，所以我觉得我们明天可以先确认目标然后再决定下一步这样会更清楚。',
    valid: (text: string) => /明天/.test(text) && /目标/.test(text) && !/[a-z]{3}/i.test(text)
  },
  {
    label: 'Traditional Chinese',
    text: '這個計劃我覺得是可以的，但是我們還需要討論一下時間的安排，因為現在還沒有確定好所以可能要等到明天。',
    valid: (text: string) => /明天/.test(text) && /[這計劃覺們還討論時間為現確]/.test(text) && !/[这计划觉们还讨论时间为现确]/.test(text)
  },
  {
    label: 'Mixed Chinese and English terms',
    text: '这个 API 的 timeout 是30秒但是error message不是很清楚，所以用户不知道发生什么了我建议把它写的更容易理解。',
    valid: (text: string) => /API/.test(text) && /timeout/.test(text) && /error message/i.test(text) && /30/.test(text) && /[\u3400-\u9fff]/.test(text)
  }
]

export async function runRefineVerification(): Promise<void> {
  const config = loadConfig()
  let failed = 0
  let checks = 0
  console.log(`Refinement verification — ${config.llm.provider} / ${config.llm.models[config.llm.provider]}`)
  try {
    const provider = createLlmProvider(config, getSecret(config.llm.provider), undefined,
      config.llm.provider === 'azure' ? (input, init) => net.fetch(input instanceof URL ? input.href : input, init) : undefined)
    for (const sample of CASES) {
      let parser = new RefinementParser()
      try {
        for await (const chunk of streamRefinement(provider, { mode: 'refine', text: sample.text, raw: sample.text }, AbortSignal.timeout(60000), () => { parser = new RefinementParser() })) {
          parser.push(chunk)
        }
        const result = parser.end().refined ?? ''
        const pass = !!result && sample.valid(result)
        checks++
        if (!pass) failed++
        console.log(`${pass ? 'PASS' : 'FAIL'} ${sample.label}\n  ${result}`)
        if (result) {
          let retry = new RefinementParser()
          for await (const chunk of streamRefinement(provider, { mode: 'refine', text: sample.text, raw: sample.text, previousRefinement: result }, AbortSignal.timeout(60000), () => { retry = new RefinementParser() })) {
            retry.push(chunk)
          }
          const alternative = retry.end().refined ?? ''
          const different = alternative.replace(/\s+/g, ' ') !== result.replace(/\s+/g, ' ')
          const retryPass = !!alternative && sample.valid(alternative) && different
          checks++
          if (!retryPass) failed++
          console.log(`${retryPass ? 'PASS' : 'FAIL'} ${sample.label}, another version\n  ${alternative}`)
        }
      } catch (err) {
        checks++
        failed++
        console.log(`FAIL ${sample.label}: ${describeError(config.llm.provider, err).message}`)
      }
    }
  } catch (err) {
    console.log(`Cannot verify: ${describeError(config.llm.provider, err).message}`)
    app.exit(2)
    return
  }
  console.log(`${checks - failed}/${checks} language, meaning, and variation checks passed; review the printed wording for quality.`)
  app.exit(failed ? 1 : 0)
}
