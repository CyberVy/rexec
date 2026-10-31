// crawler.ts
export { scan_record_object, smart_fetch } from "./crawler"

// data_generation_lib.ts
export {
    generate_silent_wav_base64,
    generate_pending_html,
    generate_cover_svg,
    generate_cover_svg_data_uri
} from "./data_generation_lib"
export type { CoverImageOptions } from "./data_generation_lib"

// device.client.ts
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
} from "./device.client"

// filter.ts
export { are_arrays_strictly_equal, are_arrays_content_equal } from "./filter"

// gestures.client.ts
export { create_press_gesture, create_swipe_gesture, prevent_ios_magnifier_on_target } from "./gestures.client"
export type { PressCancelReason, SwipeGestureParams } from "./gestures.client"

// keep_alive.client.ts
export { keep_alive_for_once, auto_keep_alive_by_video_states } from "./keep_alive.client"

// storage
export { LocalStorageMap } from "./storage/kv.client"
export { LocalForageMap } from "./storage/db.client"

// version.ts
export { is_later_version } from "./version"
export { default as version } from "./version"

// service_worker.client.ts
export { service_worker_api_call, SERVICE_WORKER_API_PATH } from "./service_worker.client"
export type {
    ServiceWorkerApiRequestEnvelope,
    ServiceWorkerApiResponseEnvelope,
    ServiceWorkerApiRequestParams
} from "./service_worker.client"

// migration.client.ts
export { MigrationService } from "./migration.client"

// webview.client.ts
export { create_child_webview, destroy_child_webview, set_window_layout } from "./webview.client"
export type { LayoutItem } from "./webview.client"

// base_controller.ts
export { BaseController, BaseKeyedController } from "./base_controller"

// logger.ts
export { LogLevel, Logger, create_logger } from "./logger"
