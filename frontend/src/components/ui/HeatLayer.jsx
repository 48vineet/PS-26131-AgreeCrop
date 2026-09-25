import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

export default function HeatLayer({ points }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    layerRef.current = L.heatLayer(points, {
      radius: 28,
      blur: 20,
      maxZoom: 15,
      minOpacity: 0.35,
    }).addTo(map);

    return () => {
      if (map.hasLayer(layerRef.current)) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = null;
    };
  }, [map, points]);

  return null;
}
