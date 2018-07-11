
import * as fs from 'fs'
import * as path from 'path'
import * as lru from 'lru-cache'
import * as algolia from 'algoliasearch'

import { Request, Response } from 'express'
import { Fastr, dnsCache, Logger } from 'h4ktube-commons'

// Configuration settings
const algoliaAppId = 'DR90AOGGE9'
const algoliaApiKey = 'c2655fa0f331ebf28c89f16ec8268565'
const algoliaIndexName = 'videos'
const videoCacheSize = 500
const videoCacheTTL = 1000 * 60 * 60 
Logger.enabled = true

// Configure video cache
let videoCache = lru({ 
  max: videoCacheSize, 
  maxAge: videoCacheTTL
})

// Configure DNS cache
dnsCache()

// Configure Express application dependencies
let express = require('express')
let body = require('body-parser')
let mustache = require('mustache-express')
let cors = require('cors')

let app = express()
let devMode = process.env.DEV_MODE === 'true' || process.argv[2] === 'dev'
let staticDir = devMode ? '../dist' : './dist'
let port = process.env.PORT || 8100

let client = algolia(algoliaAppId, algoliaApiKey)
let index = client.initIndex(algoliaIndexName)

app.use(cors())
app.use(body.json())
app.use(express.static(staticDir, {
  index: false
}))

app.engine('html', mustache())

app.set('port', port)
app.set('view engine', 'mustache')
app.set('view cache', !devMode)
app.set('views', path.join(__dirname, staticDir))

// Preload static data
let newVideos = JSON.parse(fs.readFileSync(path.join(__dirname, staticDir) + '/latest.json', 'utf8')).videos
let newVideosSinceYesterday = newVideos.filter(v => v.ageInDays <= 1).map(v => v.videoId)

// EXPERIMENTAL FUSE.JS MODE
let fuseMode = process.env.FUSE_MODE
let fuseDir = `${__dirname}/backup`
let fastr = fuseMode ? new Fastr(fuseDir) : undefined

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Application logic
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let featuredOrUndefined = () => {
  if (!fuseMode) {
    return undefined
  }
  let tags = fastr.searchTags()
  let channels = fastr.searchChannels()
  let speakers = fastr.searchSpeakers()
  return JSON.stringify({
    tags: tags,
    channels: channels,
    speakers: speakers
  })
}

async function proxy(req: Request, res: Response) {
  console.log(`REQUEST PATH: ${req.path}`)
  if (!req.path || req.path == '/') {

    let title = 'DevTube - The best developer videos in one place'
    let description = 'Enjoy the best technical videos and share it with friends, colleagues, and the world.'
    const domain = 'h4k.tube';

    res.render('index.html', {      
      title: title,
      fuseMode: fuseMode,
      featured: featuredOrUndefined(),
      newVideos: JSON.stringify(newVideosSinceYesterday),
      meta: [
        { name: "description", content: description },
        { name: "og:title", content: title },
        { name: "og:description", content: description },
        { name: "og:image", content: 'https://' + domain + '/open_graph.jpg' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: 'https://' + domain + '/open_graph.jpg' }
      ]
    })
    } else if (req.path.startsWith("/@")) {

    let speaker = req.path.split("/@")[1]
    let title = `DevTube - Videos by @${speaker}`
    let description = 'Enjoy the best technical videos and share it with friends, colleagues, and the world.'
    const domain = 'h4k.tube';

    res.render('index.html', {
      title: title,
      featured: featuredOrUndefined(),
      speaker: `"${speaker}"`,
      fuseMode: fuseMode,
      meta: [
        { name: "description", content: description },
        { name: "og:title", content: title },
        { name: "og:description", content: description },
        { name: "og:image", content: 'https://' + domain + '/open_graph.jpg' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: 'https://' + domain + '/open_graph.jpg' }
      ]
    })
    } else if (req.path.startsWith("/tag/")) {

    let tag = req.path.split("/tag/")[1]
    let title = `DevTube - Videos by topic @${tag}`
    let description = 'Enjoy the best technical videos and share it with friends, colleagues, and the world.'
    const domain = 'h4k.tube';

    res.render('index.html', {
      title: title,
      featured: featuredOrUndefined(),
      fuseMode: fuseMode,
      meta: [
        { name: "description", content: description },
        { name: "og:title", content: title },
        { name: "og:description", content: description },
        { name: "og:image", content: 'https://' + domain + '/open_graph.jpg' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: 'https://' + domain + '/open_graph.jpg' }
      ]
    })    
  } else if (req.path.startsWith("/search") && fuseMode) {

    let { query, page, refinement, sortOrder } = req.body.requests[0].params

    console.time(`Query ${query}`)
    let maxHitsPerPage = 21
    let hitsAll = fastr.search(query, refinement, sortOrder)

    let from = page * maxHitsPerPage
    let to = from + maxHitsPerPage

    let hitsPage = hitsAll.slice(from, to)
    let nbPages = Math.ceil(hitsAll.length / maxHitsPerPage)

    console.timeEnd(`Query ${query}`)
    res.status(200).send(
      {
        "results": [
          {
            "hits": hitsPage,
            "page": page,
            "nbHits": hitsAll.length,
            "nbPages": nbPages,
            "hitsPerPage": maxHitsPerPage
          }
        ]
      }
     )
  } else if (req.path.startsWith('/video/')) {
    let objectID = req.path.split('/')[2]
    console.log(`VIDEO REQUEST: ${objectID}`)
    try {
      let video = videoCache.has(objectID) ? videoCache.get(objectID) : await index.getObject(objectID) as any
      videoCache.set(objectID, video)
      res.render('index.html', {
        title: `${video.title} - Watch at Dev.Tube`,
        fuseMode: fuseMode,
        featured: featuredOrUndefined(),
        preloadedEntity: JSON.stringify(video),
        meta: [
          { name: 'description', content: video.description },
          { name: "og:title", content: video.title },
          { name: "og:description", content: video.description },
          { name: "og:image", content: `https://img.youtube.com/vi/${video.objectID}/maxresdefault.jpg` },
          { name: 'twitter:title', content: video.title },
          { name: 'twitter:description', content: video.description },
          { name: 'twitter:image', content: `https://img.youtube.com/vi/${video.objectID}/maxresdefault.jpg` }
        ]
      })
    } catch (e) {      
      if (e.statusCode && e.statusCode == 404) {
        res.status(404).send('Not found')
      } else {
        console.error(e) 

        res.render('index.html', {
          title: `Error at Dev.Tube`,
          serverSideError: JSON.stringify(
            { message: 'Sorry, but the video is not available now. We\'re working on the solution.' })
        })

      }
    }
  } else {
    if (fs.existsSync('.' + req.path)) {
      res.sendFile('.' + req.path)
    } else {
      res.status(404).send()
    }
  }
}

app.get("*", proxy)
app.post("*", proxy)

if (devMode) {
  let listener = app.listen(port, () => {
    console.log('Your app is listening on port ' + listener.address().port)
  })
}

module.exports = app
