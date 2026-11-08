import * as React from "react"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

import { MarkdownRenderActionContext } from "../context"
import { MarkdownBlockImage } from "./BlockImage"

const { mediaMock, getWrappedElementSizeMock } = vi.hoisted(() => ({
  mediaMock: vi.fn(
    ({
      blurhash: _blurhash,
      mediaContainerClassName: _mediaContainerClassName,
      popper: _popper,
      proxy: _proxy,
      showFallback: _showFallback,
      type: _type,
      ...props
    }: React.ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>) => (
      <img alt="" data-testid="media" {...props} />
    ),
  ),
  getWrappedElementSizeMock: vi.fn(() => ({ h: 0, w: 640 })),
}))

vi.mock("../../media/Media", () => ({
  Media: mediaMock,
}))

vi.mock("~/providers/wrapped-element-provider", () => ({
  useWrappedElementSize: getWrappedElementSizeMock,
}))

const renderComponent = async (element: React.ReactNode) => {
  const container = document.createElement("div")
  document.body.append(container)

  const root = createRoot(container)

  await act(async () => {
    root.render(element)
  })

  return { container, root }
}

describe("MarkdownBlockImage", () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  test("passes image context menu events with the resolved image URL", async () => {
    const onImageContextMenu = vi.fn()

    ;({ container, root } = await renderComponent(
      <MarkdownRenderActionContext
        value={{
          ensureAndRenderTimeStamp: () => false,
          isAudio: () => false,
          onImageContextMenu,
          transformUrl: (url) => (url ? new URL(url, "https://example.com/post").href : url),
        }}
      >
        <MarkdownBlockImage src="./image.png" width={700} height={400} />
      </MarkdownRenderActionContext>,
    ))

    const image = container?.querySelector('[data-testid="media"]')
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 34,
    })

    await act(async () => {
      image?.dispatchEvent(event)
    })

    expect(onImageContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ clientX: 12, clientY: 34 }),
      "https://example.com/image.png",
    )
  })

  test("strips hard-coded width/height from inline style when width/height attributes exist", async () => {
    ;({ container, root } = await renderComponent(
      <MarkdownRenderActionContext
        value={{
          ensureAndRenderTimeStamp: () => false,
          isAudio: () => false,
          onImageContextMenu: undefined,
          transformUrl: (url) => url,
        }}
      >
        <MarkdownBlockImage
          src="https://tvax1.sinaimg.cn/mw2000/test.jpg"
          width={2048}
          height={2730}
          style={{ width: "2048px", height: "2730px", margin: "auto" }}
        />
      </MarkdownRenderActionContext>,
    ))

    const image = container?.querySelector('[data-testid="media"]') as HTMLElement & {
      style: CSSStyleDeclaration
    }
    expect(image).not.toBeNull()
    // Other style properties are preserved…
    expect(image.style.margin).toBe("auto")
    // …but the hard-coded width/height are dropped so Media's AspectRatio owns the size
    expect(image.style.width).toBe("")
    expect(image.style.height).toBe("")
  })

  test("keeps inline style untouched when width/height attributes are absent", async () => {
    ;({ container, root } = await renderComponent(
      <MarkdownRenderActionContext
        value={{
          ensureAndRenderTimeStamp: () => false,
          isAudio: () => false,
          onImageContextMenu: undefined,
          transformUrl: (url) => url,
        }}
      >
        <MarkdownBlockImage
          src="https://example.com/icon.png"
          style={{ width: "1rem", height: "1rem" }}
        />
      </MarkdownRenderActionContext>,
    ))

    const image = container?.querySelector('[data-testid="media"]') as HTMLElement & {
      style: CSSStyleDeclaration
    }
    expect(image).not.toBeNull()
    expect(image.style.width).toBe("1rem")
    expect(image.style.height).toBe("1rem")
  })
})
