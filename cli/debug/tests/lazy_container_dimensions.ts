import { evaluate_in_browser, parse_numeric_option, read_debug_port } from "./debug_bridge_client"

const DEFAULT_TOLERANCE = 0
const DEFAULT_SETTLE_MS = 500

interface Dimension {
    width: number
    height: number
}

interface DimensionComparison {
    source_index: number
    target_index: number
    source: Dimension
    target: Dimension
    delta: number
}

interface DimensionCheck {
    max_delta: number | null
    failure_count: number
    examples: DimensionComparison[]
}

interface LazyContainerGroupResult {
    group_id: number
    parent_tag: string
    parent_class_name: string
    actual_count: number
    placeholder_count: number
    actual_branch_sizes: Dimension[]
    placeholder_branch_sizes: Dimension[]
    actual_wrapper_sizes: Dimension[]
    placeholder_wrapper_sizes: Dimension[]
    branch_check: DimensionCheck
    wrapper_check: DimensionCheck
}

interface LazyContainerCheckResult {
    url: string
    viewport: {
        width: number
        height: number
    }
    total_lazy_container_count: number
    rendered_lazy_container_count: number
    groups: LazyContainerGroupResult[]
}

function create_browser_check_code(tolerance: number, settle_ms: number): string {
    return `(async () => {
        const tolerance = ${tolerance}
        const settle_ms = ${settle_ms}
        const wait_for_render = () => new Promise((resolve) => setTimeout(resolve, settle_ms))
        const get_class_name = (element) => typeof element.className === "string" ? element.className : ""
        const is_rendered = (element) => {
            if (!element) return false
            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            return rect.width > 0
                && rect.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0"
        }
        const measure = (element) => {
            const rect = element.getBoundingClientRect()
            return {
                width: rect.width,
                height: rect.height
            }
        }
        const get_unique_sizes = (measurements, key) => {
            const sizes = []
            const signatures = new Set()
            for (const measurement of measurements){
                const size = measurement[key]
                const signature = size.width + "x" + size.height
                if (signatures.has(signature)) continue
                signatures.add(signature)
                sizes.push(size)
            }
            return sizes
        }
        const get_delta = (source, target) => Math.max(
            Math.abs(source.width - target.width),
            Math.abs(source.height - target.height)
        )
        const compare_direction = (source_measurements, target_measurements, key) => {
            const comparisons = []
            for (const source_measurement of source_measurements){
                let nearest = null
                for (const target_measurement of target_measurements){
                    const source_size = source_measurement[key]
                    const target_size = target_measurement[key]
                    const delta = get_delta(source_size, target_size)
                    if (!nearest || delta < nearest.delta){
                        nearest = {
                            source_index: source_measurement.index,
                            target_index: target_measurement.index,
                            source: source_size,
                            target: target_size,
                            delta
                        }
                    }
                }
                if (nearest) comparisons.push(nearest)
            }
            return comparisons
        }
        const compare_sizes = (actual_measurements, placeholder_measurements, key) => {
            if (!actual_measurements.length || !placeholder_measurements.length){
                return {
                    max_delta: null,
                    failure_count: 0,
                    examples: []
                }
            }

            const comparisons = [
                ...compare_direction(actual_measurements, placeholder_measurements, key),
                ...compare_direction(placeholder_measurements, actual_measurements, key)
            ]
            const failed_comparisons = comparisons.filter((comparison) => comparison.delta > tolerance)
            return {
                max_delta: Math.max(...comparisons.map((comparison) => comparison.delta)),
                failure_count: failed_comparisons.length,
                examples: failed_comparisons.slice(0, 8).map((comparison) => ({
                    source_index: comparison.source_index,
                    target_index: comparison.target_index,
                    source: comparison.source,
                    target: comparison.target,
                    delta: comparison.delta
                }))
            }
        }

        await wait_for_render()

        const containers = Array.from(document.querySelectorAll("[data-lazy-state]"))
        const parent_ids = new WeakMap()
        const groups = new Map()
        let next_group_id = 0
        let rendered_lazy_container_count = 0

        const get_group = (parent) => {
            let group_id = parent_ids.get(parent)
            if (group_id === undefined){
                group_id = next_group_id++
                parent_ids.set(parent, group_id)
                groups.set(group_id, {
                    group_id,
                    parent_tag: parent.tagName,
                    parent_class_name: get_class_name(parent),
                    measurements: []
                })
            }
            return groups.get(group_id)
        }

        containers.forEach((container, index) => {
            const state = container.getAttribute("data-lazy-state")
            const branch = container.firstElementChild
            const parent = container.parentElement
            if (!parent || !branch || !["content", "placeholder"].includes(state || "")) return
            if (!is_rendered(container) || !is_rendered(branch)) return

            rendered_lazy_container_count += 1
            get_group(parent).measurements.push({
                index,
                state,
                wrapper: measure(container),
                branch: measure(branch)
            })
        })

        const group_results = Array.from(groups.values()).map((group) => {
            const actual_measurements = group.measurements.filter((measurement) => measurement.state === "content")
            const placeholder_measurements = group.measurements.filter((measurement) => measurement.state === "placeholder")
            return {
                group_id: group.group_id,
                parent_tag: group.parent_tag,
                parent_class_name: group.parent_class_name,
                actual_count: actual_measurements.length,
                placeholder_count: placeholder_measurements.length,
                actual_branch_sizes: get_unique_sizes(actual_measurements, "branch"),
                placeholder_branch_sizes: get_unique_sizes(placeholder_measurements, "branch"),
                actual_wrapper_sizes: get_unique_sizes(actual_measurements, "wrapper"),
                placeholder_wrapper_sizes: get_unique_sizes(placeholder_measurements, "wrapper"),
                branch_check: compare_sizes(actual_measurements, placeholder_measurements, "branch"),
                wrapper_check: compare_sizes(actual_measurements, placeholder_measurements, "wrapper")
            }
        })

        return {
            url: location.href,
            viewport: { width: innerWidth, height: innerHeight },
            total_lazy_container_count: containers.length,
            rendered_lazy_container_count,
            groups: group_results
        }
    })()`
}

function format_sizes(sizes: Dimension[]): string {
    if (!sizes.length) return "none"
    return sizes.map((size) => `${size.width}x${size.height}`).join(", ")
}

function format_delta(delta: number | null): string {
    return delta === null ? "n/a" : `${delta}px`
}

function print_result(result: LazyContainerCheckResult, tolerance: number, require_pair: boolean): boolean {
    console.log(`URL: ${result.url}`)
    console.log(`Viewport: ${result.viewport.width}x${result.viewport.height}`)
    console.log(`LazyContainers: ${result.rendered_lazy_container_count}/${result.total_lazy_container_count} rendered`)

    let has_failure = false
    let comparable_group_count = 0

    for (const group of result.groups) {
        const label = `${group.parent_tag}.${group.parent_class_name || "(no-class)"}`
        if (!group.actual_count || !group.placeholder_count) {
            console.log(`[SKIP] group ${group.group_id}: ${label}`)
            console.log(`  content: ${group.actual_count}, placeholder: ${group.placeholder_count}`)
            continue
        }

        comparable_group_count += 1
        const group_failed = group.branch_check.failure_count > 0 || group.wrapper_check.failure_count > 0
        has_failure = has_failure || group_failed
        console.log(`[${group_failed ? "FAIL" : "PASS"}] group ${group.group_id}: ${label}`)
        console.log(
            `  content sizes: actual ${format_sizes(group.actual_branch_sizes)}; placeholder ${format_sizes(group.placeholder_branch_sizes)}`
        )
        console.log(`  content max delta: ${format_delta(group.branch_check.max_delta)}`)
        console.log(
            `  wrapper sizes: actual ${format_sizes(group.actual_wrapper_sizes)}; placeholder ${format_sizes(group.placeholder_wrapper_sizes)}`
        )
        console.log(`  wrapper max delta: ${format_delta(group.wrapper_check.max_delta)}`)

        for (const example of [...group.branch_check.examples, ...group.wrapper_check.examples].slice(0, 8)) {
            console.log(
                `  - ${example.source.width}x${example.source.height} vs ${example.target.width}x${example.target.height}: ${example.delta}px`
            )
        }
    }

    if (!result.groups.length) {
        console.log("No rendered LazyContainer instances were found on the current page.")
        has_failure = true
    } else if (!comparable_group_count) {
        console.log("No layout group currently contains both content and placeholder instances.")
        if (require_pair) has_failure = true
    }

    console.log(`Tolerance: ${tolerance}px`)
    return has_failure
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const tolerance = parse_numeric_option(args, "--tolerance", DEFAULT_TOLERANCE)
    const settle_ms = parse_numeric_option(args, "--settle-ms", DEFAULT_SETTLE_MS)
    const require_pair = args.includes("--require-pair")
    const port = read_debug_port()
    const result = await evaluate_in_browser<LazyContainerCheckResult>(
        port,
        create_browser_check_code(tolerance, settle_ms)
    )

    if (!result || !Array.isArray(result.groups)) {
        throw new Error("Debug bridge returned an invalid LazyContainer dimension result")
    }

    if (print_result(result, tolerance, require_pair)) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    console.error(`LazyContainer dimension check failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
})
