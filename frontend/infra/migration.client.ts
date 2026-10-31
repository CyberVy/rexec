import { is_ios_device, is_android_device } from "./device.client"
import localforage from "localforage"
import { create_logger } from "./logger"

const logger = create_logger("MigrationService")

export type TargetDatabasesConfig = Record<string, string[]>

export interface BackupPackage {
    metadata: {
        app: string
        version: string
        exported_at: string
    }
    // db_name -> store_name -> { [key: string]: any }
    databases: Record<string, Record<string, Record<string, any>>>
}

export interface ImportOptions {
    mode: "overwrite" | "merge"
    merge_rules?: Record<string, { identity_key: string | string[] }>
}

export class MigrationService {
    public static async generate_backup_data(
        app_id: string,
        app_version: string,
        target_databases: TargetDatabasesConfig
    ): Promise<string> {
        const databases: Record<string, Record<string, Record<string, any>>> = {}

        if (typeof window !== "undefined") {
            for (const db_name of Object.keys(target_databases)) {
                const store_names = target_databases[db_name] || []
                const db_stores_data: Record<string, Record<string, any>> = {}

                for (const store_name of store_names) {
                    const lf = localforage.createInstance({
                        name: db_name,
                        storeName: store_name
                    })
                    const store_data: Record<string, any> = {}
                    await lf.iterate((val, key) => {
                        store_data[key] = val
                    })
                    db_stores_data[store_name] = store_data
                }

                databases[db_name] = db_stores_data
            }
        }

        const backup_package: BackupPackage = {
            metadata: {
                app: app_id,
                version: app_version,
                exported_at: new Date().toISOString()
            },
            databases
        }

        return JSON.stringify(backup_package, null, 2)
    }

    /**
     * Parse package and automatically write or merge databases & stores
     */
    public static async restore_from_backup_data(
        json_str: string,
        expected_app_id: string,
        options: ImportOptions
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const backup_package = JSON.parse(json_str) as BackupPackage

            // 1. Basic validation
            if (!backup_package.metadata || backup_package.metadata.app !== expected_app_id) {
                return { success: false, error: "Invalid backup file: Application identifier mismatch" }
            }

            const databases = backup_package.databases
            if (!databases || typeof databases !== "object") {
                return { success: false, error: "Invalid backup file: Missing databases payload" }
            }

            const { mode, merge_rules = {} } = options

            // 2. Iterate through each database and store
            for (const db_name of Object.keys(databases)) {
                const db_stores = databases[db_name]
                if (!db_stores || typeof db_stores !== "object") continue

                for (const store_name of Object.keys(db_stores)) {
                    const lf = localforage.createInstance({
                        name: db_name,
                        storeName: store_name
                    })

                    if (mode === "overwrite") {
                        await lf.clear()
                    }

                    const store_payload = db_stores[store_name]
                    if (!store_payload || typeof store_payload !== "object") continue

                    for (const key of Object.keys(store_payload)) {
                        const val = store_payload[key]

                        // Merge mode for array values with identity_key rule
                        if (mode === "merge" && merge_rules[store_name] && Array.isArray(val)) {
                            const rule = merge_rules[store_name]
                            const current_val = await lf.getItem<any[]>(key)
                            const current = Array.isArray(current_val) ? current_val : []

                            const merged = [...current]
                            for (const item of val) {
                                const is_duplicate = merged.some((x) => {
                                    if (
                                        typeof item === "object" &&
                                        item !== null &&
                                        typeof x === "object" &&
                                        x !== null
                                    ) {
                                        if (Array.isArray(rule.identity_key)) {
                                            return rule.identity_key.every((k) => x[k] === item[k])
                                        }
                                        const item_k = item[rule.identity_key]
                                        const x_k = x[rule.identity_key]
                                        return item_k !== undefined && x_k === item_k
                                    }
                                    return x === item
                                })
                                if (!is_duplicate) {
                                    merged.push(item)
                                }
                            }

                            await lf.setItem(key, merged)
                            continue
                        }

                        // Standard write
                        await lf.setItem(key, val)
                    }
                }
            }

            return { success: true }
        } catch (e) {
            logger.error("Failed to restore backup", e)
            return { success: false, error: e instanceof Error ? e.message : String(e) }
        }
    }

    public static async export_file(
        app_id: string,
        app_version: string,
        target_databases: TargetDatabasesConfig
    ): Promise<{ success: boolean; method?: "picker" | "share" | "download"; error?: string }> {
        try {
            const backup_json = await this.generate_backup_data(app_id, app_version, target_databases)
            const filename = `${app_id}_backup_${new Date().toISOString().slice(0, 10)}.json`

            const is_mobile = is_ios_device() || is_android_device()

            if (is_mobile) {
                const blob = new Blob([backup_json], { type: "application/json" })
                if (navigator.share) {
                    try {
                        const file = new File([blob], filename, { type: "application/json" })
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file]
                            })
                            return { success: true, method: "share" }
                        }
                    } catch (share_err) {
                        if (share_err instanceof Error && share_err.name === "AbortError") {
                            return { success: false }
                        }
                        logger.warn("navigator.share failed, falling back to download", { error: share_err })
                    }
                }
            } else {
                if (window.showSaveFilePicker) {
                    try {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: filename,
                            types: [
                                {
                                    description: "JSON Files",
                                    accept: {
                                        "application/json": [".json"]
                                    }
                                }
                            ]
                        })
                        const writable = await handle.createWritable()
                        await writable.write(backup_json)
                        await writable.close()
                        return { success: true, method: "picker" }
                    } catch (picker_err) {
                        if (picker_err instanceof Error && picker_err.name === "AbortError") {
                            return { success: false }
                        }
                        logger.warn("showSaveFilePicker failed, falling back to download", { error: picker_err })
                    }
                }
            }

            const blob = new Blob([backup_json], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            return { success: true, method: "download" }
        } catch (err) {
            logger.error("Export file failed", err)
            return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
    }

    public static async read_file(): Promise<string | null> {
        return new Promise((resolve) => {
            const input = document.createElement("input")
            input.type = "file"
            input.accept = ".json"
            input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) {
                    resolve(null)
                    return
                }
                const reader = new FileReader()
                reader.onload = (event) => {
                    resolve((event.target?.result as string) || null)
                }
                reader.onerror = () => resolve(null)
                reader.readAsText(file)
            }
            input.click()
        })
    }
}
