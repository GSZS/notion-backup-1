#!/usr/bin/env node
/* eslint no-await-in-loop: 0 */

let axios = require('axios')
  , extract = require('extract-zip')
  , { retry } = require('async')
  , { createWriteStream, mkdirSync, rmdirSync } = require('fs')
  , { join } = require('path')
  , notionAPI = 'https://www.notion.so/api/v3'
  , { NOTION_TOKEN, NOTION_SPACE_ID, EXPORT_FORMAT } = process.env
  , client = axios.create({
      baseURL: notionAPI,
      headers: {
        Cookie: `token_v2=${NOTION_TOKEN}`
      },
    })
  , die = (str) => {
      console.error(str);
      process.exit(1);
    }
;

if (!NOTION_TOKEN || !NOTION_SPACE_ID) {
  die(`Need to have both NOTION_TOKEN and NOTION_SPACE_ID defined in the environment.
See https://medium.com/@arturburtsev/automated-notion-backups-f6af4edc298d for
notes on how to get that information.`);
}

async function post (endpoint, data) {
  return client.post(endpoint, data);
}

async function sleep (seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

// formats: markdown, html
async function exportFromNotion (format) {
  try {
    let { data: { taskId } } = await post('enqueueTask', {
      task: {
        eventName: 'exportSpace',
        request: {
          spaceId: NOTION_SPACE_ID,
          exportOptions: {
            exportType: format,
            timeZone: 'America/New_York',
            locale: 'en',
          },
        },
      },
    });
    console.warn(`Enqueued task ${taskId}`);
    let failCount = 0
      , exportURL
    ;
    while (true) {
      await sleep(2);
      let { data: { results: tasks } } = await retry(
        { times: 3, interval: 2000 },
        async () => post('getTasks', { taskIds: [taskId] })
      );
      let task = tasks.find(t => t.id === taskId);
      // console.warn(JSON.stringify(task, null, 2)); // DBG
      if (task.state === 'in_progress') console.warn(`Pages exported: ${task.status.pagesExported}`);
      if (task.state === 'failure') {
        failCount++;
        console.warn(`Task error: ${task.error}`);
        if (failCount === 5) break;
      }
      if (task.state === 'success') {
        exportURL = task.status.exportURL;
        break;
      }
    }
    let res = await client({
      method: 'GET',
      url: exportURL,
      responseType: 'stream'
    });
    let stream = res.data.pipe(createWriteStream(join(process.cwd(), `${format}.zip`)));
    await new Promise((resolve, reject) => {
      stream.on('close', resolve);
      stream.on('error', reject);
    });
  }
  catch (err) {
    die(err);
  }
}


async function run () {
  let cwd = process.cwd();
  /**
   * EXPORT_FORMAT has two types: markdown and html.
   */
  function pathFn(formatType) {
    return join(cwd, formatType);
  }

  if (!EXPORT_FORMAT) {
    await exportFromNotion('markdown');
    rmdirSync(pathFn('markdown'), { recursive: true });
    mkdirSync(pathFn('markdown'), { recursive: true });
    await extract(pathFn('markdown.zip'), { dir: pathFn('markdown') });
  } else {
    await exportFromNotion(EXPORT_FORMAT);
    rmdirSync(pathFn(EXPORT_FORMAT), { recursive: true });
    mkdirSync(pathFn(EXPORT_FORMAT), { recursive: true });
    await extract(pathFn(`${EXPORT_FORMAT}.zip`), { dir: pathFn(EXPORT_FORMAT) });
  }
}

run();
