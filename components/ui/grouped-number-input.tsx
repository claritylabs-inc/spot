"use client";

import * as React from "react";
import { NumberField } from "@base-ui/react/number-field";
import { mergeProps } from "@base-ui/react/merge-props";
import { InputGroupInput } from "@claritylabs-inc/ui/components/input-group";

function groupedText(text: string, maximum?: number) {
  if (!/^[\d,]*(?:\.\d*)?$/.test(text)) return text;
  const raw=text.replaceAll(",", "");
  if(maximum!==undefined && raw && Number(raw)>maximum)return maximum.toLocaleString("en-US");
  const [whole,fraction]=raw.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+(fraction===undefined?"":`.${fraction}`);
}

/** Base UI owns numeric state; the shared input renders grouping during editing too. */
export function GroupedNumberInput({render,maximum,...props}: NumberField.Input.Props & {maximum?:number}) {
  return <NumberField.Input {...props} render={(inputProps,state)=>{
    const element=React.isValidElement<React.ComponentProps<"input">>(render)?render:<InputGroupInput/>;
    const merged=mergeProps(element.props,inputProps);
    return React.cloneElement(element,{
      ...merged,
      value:groupedText(state.inputValue,maximum),
      onChange:(event:React.ChangeEvent<HTMLInputElement>)=>{
        const input=event.currentTarget;
        const text=input.value;
        const position=text.slice(0,input.selectionStart??text.length).replaceAll(",","").length;
        const formatted=groupedText(text,maximum);
        let caret=0,characters=0;
        while(caret<formatted.length && characters<position){if(formatted[caret]!==",")characters++;caret++;}
        // Give Base UI the displayed text too, keeping its paste/selection offsets aligned.
        if(formatted!==text){input.value=formatted;input.setSelectionRange(caret,caret);}
        merged.onChange?.(event);
        requestAnimationFrame(()=>{if(document.activeElement===input && input.value===formatted)input.setSelectionRange(caret,caret);});
      },
    });
  }}/>;
}
