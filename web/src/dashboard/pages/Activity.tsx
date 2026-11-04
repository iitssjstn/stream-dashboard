import { ActivityList } from '../components/Shared';
import { PageHeader } from '../ui';

export function ActivityPage() {
  return (
    <>
      <PageHeader title="Activiteit" subtitle="Live overzicht van alle commands uit je chat, inclusief cooldowns en geweigerde pogingen." />
      <section className="card p-5">
        <ActivityList limit={100} />
      </section>
    </>
  );
}
