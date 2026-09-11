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
      if (!githubToken) {
        setError(language === 'zh'
          ? 'GitHub Token 未找到，请重新登录。'
          : 'GitHub token not found. Please login again.');
        setLoading(false);
        return;
      }
      try {
        const api = new GitHubApiService(githubToken);
        const result = await fetchWeeklyIssueBody(api, issueNumber);
        if (!cancelled) {
          setIssueData(result);
          if (!result?.body) {
            setError(language === 'zh' ? '暂无正文内容' : 'No content available');
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
