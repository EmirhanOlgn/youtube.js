import { Ytdl, Quality, parseVideoId } from '@distube/ytdl-core'
import prompts from 'prompts'
import cliProgress from 'cli-progress'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'child_process'

const yt = new Ytdl()
const downloadsDir = path.join(os.homedir(), 'Downloads')
const bytesToMB = b => (b / 1024 / 1024).toFixed(1)
const label = f => `${f.qualityLabel || ''} ${f.fps ? f.fps + 'fps' : ''}`.trim()

const downloadWithBar = (info, dest, name, options) => {
    return new Promise((resolve, reject) => {
        const bar = new cliProgress.SingleBar({
            format: `${String(name).toUpperCase()} | {bar} {percentage}% | {value}/{total} MB | {speed} MB/s`
        }, cliProgress.Presets.shades_classic)


        let started = false
        const start = Date.now()

        const stream = yt.download(info, {
            ...options,
            onProgress: ({ downloaded, total }) => {
                if (!started) {
                    bar.start(bytesToMB(total || 0), 0, { speed: '0.0' })
                    started = true
                }
                const speed = bytesToMB(downloaded) / ((Date.now() - start) / 1000)
                bar.update(bytesToMB(downloaded), { speed: speed.toFixed(2) })
            }
        })

        stream.pipe(fs.createWriteStream(dest))
            .on('finish', () => { bar.stop(); resolve() })
            .on('error', err => { bar.stop(); reject(err) })

        stream.on('error', reject)
    })
}

const main = async () => {
    const { url } = await prompts({
        type: 'text',
        name: 'url',
        message: 'Video linkini girin:'
    })

    if (!parseVideoId(url || '')) {
        console.error('❌ Geçersiz YouTube URL’i')
        process.exit(1)
    }

    const info = await yt.getInfo(url)

    const formats = info.formats
        .filter(f => f.container === 'mp4' && f.hasVideo && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0))

    const enrichedFormats = formats.map(f => ({
        ...f,
        display: `${label(f)} (${bytesToMB(f.contentLength || 0)} MB)`
    }))

    const { choice } = await prompts({
        type: 'select',
        name: 'choice',
        message: 'İndirme seçenekleri:',
        choices: enrichedFormats.map((f, i) => ({
            title: `${i + 1}. ${f.display}`,
            value: i
        }))
    })

    const selected = enrichedFormats[choice]
    const title = info.videoDetails.title.replace(/[<>:"/\\|?*]/g, '')
    const safeName = `${title}-${label(selected).replace(/ /g, '_')}.mp4`
    const outFile = path.join(downloadsDir, safeName)

    const tmpVideo = path.join(os.tmpdir(), 'video_stream')
    const tmpAudio = path.join(os.tmpdir(), 'audio_stream')

    console.log(`\n⬇️  İndirme başlıyor...\n`)

    await downloadWithBar(info, tmpVideo, selected.itag, { format: formats[choice] })
    await downloadWithBar(info, tmpAudio, 'highestaudio', {
        quality: Quality.HighestAudio,
        filter: { hasAudio: true, hasVideo: false }
    })

    console.log('\n🎬 FFmpeg ile birleştiriliyor...\n')

    const ff = spawn(ffmpegPath, [
        '-i', tmpVideo,
        '-i', tmpAudio,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-y',
        outFile
    ])

    ff.stderr.on('data', d => process.stdout.write(d.toString()))
    ff.on('close', code => {
        if (code === 0) {
            console.log('\n✅ Birleştirme tamamlandı →', outFile)
            fs.unlinkSync(tmpVideo)
            fs.unlinkSync(tmpAudio)
        } else {
            console.error(`\n❌ FFmpeg başarısız oldu. Kod: ${code}`)
        }
    })
}

main()
