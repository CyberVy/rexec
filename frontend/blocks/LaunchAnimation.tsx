"use client"

import { AnimatedGlowText } from "@/components/base/String"
import { useEffect, useState } from "react"
import { Image } from "@/components/composite/Image"
import { AnimationContainer } from "@/components"
import { join_classes } from "@/components/utils"

export type LaunchAnimationProps = {
    className?: string
    on_finish?: () => void
}

function LaunchAnimation({ className, on_finish }: LaunchAnimationProps) {
    const [welcome_sentence, set_welcome_sentence] = useState(() => `Struggling to wake... Just five more minutes.`)
    useEffect(() => {
        const welcome_sentences = [`Are we there yet? Oh, right. Waking up.`, `Ugh, waking up is hard.`]
        const timeout_id = setTimeout(
            () => set_welcome_sentence(welcome_sentences[Math.floor(Math.random() * welcome_sentences.length)]),
            500
        )
        return () => clearTimeout(timeout_id)
    }, [])
    return (
        <div className={join_classes("fixed inset-0 z-50 bg-background overflow-hidden select-none", className)}>
            <div className={`w-full h-full flex flex-col justify-center items-center`}>
                <AnimationContainer
                    show={true}
                    duration={2000}
                    easing="cubic-bezier(0.4, 0, 0.2, 1)"
                    enter_from={{ transform: "translate(-100%, 0)" }}
                    enter_to={{ transform: "translate(100vw, 0)" }}
                    on_enter_end={on_finish}
                    className="mb-4 mr-auto"
                    style={{ transform: "translate(-100%, 0)" }}
                >
                    <Image className={"w-12 h-12 object-cover rounded-xl"} src={"/icons/192x192.png"} />
                </AnimationContainer>
                <AnimatedGlowText text={welcome_sentence} stagger={0.06} />
            </div>
        </div>
    )
}
export { LaunchAnimation }
