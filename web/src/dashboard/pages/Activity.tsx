import { t } from '../i18n';
import { ActivityList } from '../components/Shared';
import { PageHeader } from '../ui';

export function ActivityPage() {
  return (
    <>
      <PageHeader title={t('Activity')} subtitle={t('Live overview of all commands from your chat, including cooldowns and denied attempts.')} />
      <section className="card p-5">
        <ActivityList limit={100} />
      </section>
    </>
  );
}
