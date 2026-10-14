import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/UI'
export default function PlaceholderPage({title,description}:{title:string;description:string}){return <div className="page"><PageHeader eyebrow="CLASSROOM WORKSPACE" title={title} description={description}/><EmptyState title={`${title} is ready for data`} description="This view reads from the selected classroom. Add attendance records to populate it."/></div>}
