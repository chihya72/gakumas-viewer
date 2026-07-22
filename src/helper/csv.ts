import Papa from 'papaparse'
import dataToCSV from './convert'

interface CsvDataLine {
  id: string
  name: string
  text: string
  trans: string
}

interface CsvTextInfo {
  data: CsvDataLine[]
  translator: string
  jsonUrl: string
}

function extractInfoFromCsvText(text: string): CsvTextInfo {
  const data: CsvDataLine[] = Papa.parse(text, {
    header: true, // use the first row as the header
  }).data as CsvDataLine[]
  let jsonUrl = null
  let translator = ''
  data.forEach((element: CsvDataLine) => {
    if (element.id === 'info') {
      jsonUrl = element.name
    }
    if (element.id === '译者') {
      translator = element.name
    }
  })
  if (jsonUrl === null) {
    throw new Error('wrong CSV format: no json url')
  }
  return {
    data: data.filter((item: CsvDataLine) => item.text) as CsvDataLine[],
    translator,
    jsonUrl,
  }
}

function toCsvText(info: CsvTextInfo) {
  info.data.push({
    id: 'info',
    name: info.jsonUrl,
    text: '',
    trans: '',
  })
  info.data.push({
    id: '译者',
    name: info.translator,
    text: '',
    trans: '',
  })
  return Papa.unparse(info.data)
}

// 成品 CSV 末行 `译者,<名字>,,` 是署名行。完成/上传时按当前译者改写，
// 不重新 parse 整个文件，避免动到正文的引号和换行。
function setCsvTranslator(text: string, name: string): string {
  const value = /[",\r\n]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name
  const line = `译者,${value},,`
  return /^译者,.*$/m.test(text)
    ? text.replace(/^译者,.*$/m, line)
    : `${text}${text.endsWith('\n') ? '' : '\r\n'}${line}`
}

export type { CsvDataLine }
export {
  extractInfoFromCsvText,
  setCsvTranslator,
  toCsvText,
  dataToCSV as jsonTextToCsvText,
}
