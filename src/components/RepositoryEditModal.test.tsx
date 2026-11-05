import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryEditModal } from "./RepositoryEditModal";
import { deferOutsideDismiss } from "./modalDismiss";
import type { Repository } from "../types";
import { useAppStore } from "../store/useAppStore";

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn(),
  getAllCategories: () => [],
}));

vi.mock("../services/autoSync", () => ({
  forceSyncToBackend: vi.fn(),
}));

const repository: Repository = {
  id: 1,
  name: "example-repository",
  full_name: "owner/example-repository",
  description: "Original repository description",
  html_url: "https://github.com/owner/example-repository",
  stargazers_count: 128,
  forks_count: 3,
  forks: 3,
  language: "TypeScript",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  pushed_at: "2026-01-03T00:00:00.000Z",
  owner: {
    login: "owner",
    avatar_url: "https://example.com/avatar.png",
  },
  topics: ["test"],
  ai_platforms: ["web"],
};

const storeState = {
  updateRepository: vi.fn(),
  language: "zh" as const,
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
};

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAppStore.mockImplementation(((
    selector?: (state: typeof storeState) => unknown,
  ) => (selector ? selector(storeState) : storeState)) as typeof useAppStore);
});

describe("RepositoryEditModal", () => {
  it("pins the original description when 显示原始描述 is saved (issue #565)", async () => {
    render(
      <RepositoryEditModal
        isOpen
        onClose={vi.fn()}
        repository={{ ...repository, ai_summary: "AI summary" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "显示原始描述" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalled());
    const saved = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(saved.description_display).toBe("original");
    expect(saved.custom_description).toBeUndefined();
  });

  it("returns to following the list setting when 跟随列表设置 is saved", async () => {
    render(
      <RepositoryEditModal
        isOpen
        onClose={vi.fn()}
        repository={{ ...repository, description_display: "original", custom_description: "My text" }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "跟随列表设置" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalled());
    const saved = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(saved.description_display).toBeUndefined();
    expect(saved.custom_description).toBeUndefined();
  });

  it("pins Topics when 显示Topics is saved", async () => {
    render(
      <RepositoryEditModal
        isOpen
        onClose={vi.fn()}
        repository={{ ...repository, ai_tags: ["ai-tag"] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "显示Topics" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalled());
    const saved = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(saved.tags_display).toBe("topics");
    expect(saved.custom_tags).toBeUndefined();
  });

  it("offers 显示Topics even when the repository has no Topics", async () => {
    render(
      <RepositoryEditModal
        isOpen
        onClose={vi.fn()}
        repository={{ ...repository, topics: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "显示Topics" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalled());
    const saved = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(saved.tags_display).toBe("topics");
    expect(saved.custom_tags).toBeUndefined();
  });

  it("keeps typed AI-summary text as custom when the repo is pinned to original", async () => {
    render(
      <RepositoryEditModal
        isOpen
        onClose={vi.fn()}
        repository={{
          ...repository,
          ai_summary: "AI summary",
          description_display: "original",
        }}
      />,
    );

    const description = screen.getByLabelText("自定义描述");
    fireEvent.change(description, { target: { value: "AI summary" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storeState.updateRepository).toHaveBeenCalled());
    const saved = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(saved.custom_description).toBe("AI summary");
  });

  it("preserves an in-progress draft when polling replaces the repository object", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <RepositoryEditModal isOpen onClose={onClose} repository={repository} />,
    );

    const description = screen.getByLabelText("自定义描述");
    fireEvent.change(description, {
      target: { value: "Draft that must survive sync" },
    });
    expect(description).toHaveValue("Draft that must survive sync");

    rerender(
      <RepositoryEditModal
        isOpen
        onClose={onClose}
        repository={{ ...repository, updated_at: "2026-02-01T00:00:00.000Z" }}
      />,
    );

    expect(screen.getByLabelText("自定义描述")).toHaveValue(
      "Draft that must survive sync",
    );
  });

  it("renders a fixed shell with an independently scrollable content region and footer", () => {
    render(
      <RepositoryEditModal isOpen onClose={vi.fn()} repository={repository} />,
    );

    const dialog = screen.getByRole("dialog");
    const scrollArea = screen.getByTestId("modal-scroll-area");
    const footer = screen.getByTestId("modal-footer");

    expect(dialog).toHaveClass("flex", "flex-col", "overflow-hidden");
    expect(scrollArea).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "scrollbar-on-scroll",
    );
    expect(footer).toHaveClass("shrink-0");
    expect(
      screen
        .getByText("编辑仓库信息")
        .closest('[data-testid="modal-scroll-area"]'),
    ).toBeNull();
  });

  it("shows the modal scrollbar only during active scrolling", () => {
    vi.useFakeTimers();
    try {
      render(
        <RepositoryEditModal
          isOpen
          onClose={vi.fn()}
          repository={repository}
        />,
      );
      const scrollArea = screen.getByTestId("modal-scroll-area");

      expect(scrollArea).not.toHaveClass("scrolling");
      fireEvent.scroll(scrollArea);
      expect(scrollArea).toHaveClass("scrolling");

      act(() => vi.advanceTimersByTime(700));
      expect(scrollArea).not.toHaveClass("scrolling");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears pending scroll state when the modal closes and reopens", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <RepositoryEditModal isOpen onClose={vi.fn()} repository={repository} />,
      );
      const scrollArea = screen.getByTestId("modal-scroll-area");
      fireEvent.scroll(scrollArea);
      expect(scrollArea).toHaveClass("scrolling");

      rerender(
        <RepositoryEditModal isOpen={false} onClose={vi.fn()} repository={repository} />,
      );
      rerender(
        <RepositoryEditModal isOpen onClose={vi.fn()} repository={repository} />,
      );

      expect(screen.getByTestId("modal-scroll-area")).not.toHaveClass("scrolling");
      act(() => vi.runOnlyPendingTimers());
      expect(screen.getByTestId("modal-scroll-area")).not.toHaveClass("scrolling");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the overlay mounted until its outside-click sequence finishes", () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const preventDefault = vi.fn();

      deferOutsideDismiss({ preventDefault }, onClose);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();

      act(() => vi.runOnlyPendingTimers());
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
