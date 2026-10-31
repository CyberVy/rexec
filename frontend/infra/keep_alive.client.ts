import { is_touch_device } from "@/infra/device.client"
import { generate_silent_wav_base64 } from "@/infra/data_generation_lib"

let unique_audio_element: HTMLAudioElement | null = null
function get_unique_audio_element() {
    if (!unique_audio_element) {
        unique_audio_element = document.createElement("audio")
        unique_audio_element.src = generate_silent_wav_base64(30)
        unique_audio_element.loop = true
        document.head.appendChild(unique_audio_element)
    }
    return unique_audio_element
}

// How To Keep A Page Alive On iOS
// 1. Make the **most recently played** media an active media
//
// Cautions:
// 1. An active media is a playing media.
// 2. A muted media can't be an active media.
// 3. It takes some time to make a media playing, in other word,
// it takes some time to activate a media.
// This function can help keep the page alive during the activation.
export function keep_alive_for_once(metadata?: MediaMetadata) {
    if (!is_touch_device()) return

    if (metadata) {
        navigator.mediaSession.metadata = metadata
    }
    const audio_element = get_unique_audio_element()
    audio_element.muted = false
    audio_element.play().catch(() => {})
    return audio_element
}

// beta
// window.document should be the context that contains the target
// media elements, including `HTMLAudioElement` and `HTMLVideoElement`.
export function auto_keep_alive_by_video_states() {
    if (!is_touch_device()) return

    const unplaying_states = ["pause", "waiting", "stalled", "suspend", "seeking", "ended", "emptied", "error"]

    for (const type of unplaying_states) {
        document.addEventListener(
            type,
            (event) => {
                if (event.target instanceof HTMLVideoElement) {
                    keep_alive_for_once()
                }
            },
            { capture: true }
        )
    }
}
