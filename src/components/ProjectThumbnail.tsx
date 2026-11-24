import { useEffect, useState } from "react";
import { ChartColumn, Layers3 } from "lucide-react";
import { openWorkspaceDatabase, type ProjectListItem } from "../lib/persistence/project-inventory";
import { getTheme } from "../lib/themes";

export default function ProjectThumbnail({ project }: { project: ProjectListItem }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    setImage("");
    void openWorkspaceDatabase().then(db => {
      const tx = db.transaction("previews");
      const read = tx.objectStore("previews").get("tile/" + project.id);
      tx.oncomplete = () => {
        const tile = read.result;
        if (active && tile?.updatedAt === project.updatedAt && /^data:image\/(webp|png);base64,/.test(tile.data)) setImage(tile.data);
        db.close();
      };
      tx.onabort = () => db.close();
    }).catch(() => {});
    return () => { active = false; };
  }, [project.id, project.updatedAt]);
  const theme = getTheme(project.theme);
  return <span className="project-icon" style={{ background: theme.canvas, color: theme.accent }}>
    {image ? <img className="project-thumb" src={image} alt="" /> : project.kind === "chart" ? <ChartColumn size={20}/> : <Layers3 size={20}/>}
  </span>;
}
