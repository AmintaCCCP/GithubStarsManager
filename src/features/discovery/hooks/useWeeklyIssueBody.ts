import { useEffect, useState } from 'react';
import { GitHubApiService } from '../../../services/githubApi';
import { fetchWeeklyIssueBody } from '../../../services/weeklyIssuesService';
import type { WeeklyStoredIssue } from '../../../services/weeklyIssuesStorage';
import { useAppStore } from '../../../store/useAppStore';

/**
 * "查看原贴"弹窗的正文加载：优先本地同步缓存，缺失时实时拉取兜底。
 * 业务服务调用收敛在 feature hook 层，视图组件不得直接依赖 services。
 */
export const useWeeklyIssueBody = (issueNumber: number, enabled: boolean) => {
  const githubToken = useAppStore(state => state.githubToken);
  const language = useAppStore(state => state.language);
  const [issueData, setIssueData] = useState<WeeklyStoredIssue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !issueNumber) return;
    let cancelled = false;
    setIssueData(null);
    setError(null);
    setLoading(true);
    const load = async () => {
      // 缓存命中无需 token（logout 不清周刊缓存）；仅在缓存未命中且有 token 时才建 API 回源
      try {
        const api = githubToken ? new GitHubApiService(githubToken) : null;
        const result = await fetchWeeklyIssueBody(api, issueNumber);
        if (!cancelled) {
          setIssueData(result);
          if (!result?.body) {
            setError(language === 'zh'
              ? (githubToken ? '暂无正文内容' : 'GitHub Token 未找到，请重新登录。')
              : (githubToken ? 'No content available' : 'GitHub token not found. Please login again.'));
          }
        }
      } catch {
        if (!cancelled) {
          setError(language === 'zh'
            ? '正文加载失败，请检查网络后重试'
            : 'Failed to load content. Please check your network and retry.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, issueNumber, githubToken, language]);

  return { issueData, loading, error };
};
