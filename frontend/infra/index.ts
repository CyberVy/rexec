// crawler.ts
export { smart_fetch } from "./crawler"

// data_generation_lib.ts
export {
    generate_silent_wav_base64,
    generate_pending_html,
    generate_cover_svg,
    generate_cover_svg_data_uri
} from "./data_generation_lib"
export type { CoverImageOptions } from "./data_generation_lib"

// device.ts
export {
    is_apple_device,
    is_touch_device,
    is_ios_device,
    is_ios_desktop_device,
    is_android_device,
    is_iphone,
    is_mac,
    is_ipad,
    is_in_pwa,
    is_in_webview,
    is_in_native,
    is_in_browser,
    is_service_worker_available,
    is_in_background,
    is_viewport_portrait,
    is_in_dark,
    ios_haptic,
    vibrate,
    open_url
} from "./device"

// filter.ts
export { are_arrays_strictly_equal, are_arrays_content_equal } from "./filter"

// gestures.ts
export { create_press_gesture, create_swipe_gesture, prevent_ios_magnifier_on_target } from "./gestures"
export type { PressCancelReason, SwipeGestureParams } from "./gestures"

// keep_alive.ts
export { keep_alive_for_once, auto_keep_alive_by_video_states } from "./keep_alive"

// storage
export { LocalStorageMap } from "./storage/kv"
export { LocalForageMap } from "./storage/db"

// version.ts
export { is_later_version } from "./version"
export { default as version } from "./version"

// service_worker.ts
export { service_worker_api_call, SERVICE_WORKER_API_PATH } from "./service_worker"
export type {
    ServiceWorkerApiRequestEnvelope,
    ServiceWorkerApiResponseEnvelope,
    ServiceWorkerApiRequestParams
} from "./service_worker"

// file.ts
export { save_text_file, read_text_file } from "./file"
export type { SaveFileResult } from "./file"

// webview.ts
export { create_child_webview, destroy_child_webview, set_window_layout } from "./webview"
export type { LayoutItem } from "./webview"

// ios_ipc.ts
export {
    IosIPCError,
    init_ios_ipc_runtime,
    is_ios_ipc_available,
    has_ios_capability,
    ios_ipc_call,
    handle_ios_ipc
} from "./ios_ipc"
export type { IosIPCErrorCode, IosIPCRequestParams, IosIPCHandler, IosIPCHandleParams } from "./ios_ipc"

// base_controller.ts
export { BaseController, BaseKeyedController } from "./base_controller"
