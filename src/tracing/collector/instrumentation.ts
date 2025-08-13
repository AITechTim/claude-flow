/**
 * Agent Instrumentation - Automatic tracing for agents and operations
 */

import { TraceCollector } from './trace-collector';
import { TraceEventType } from '../types';

export class AgentInstrumentation {
  private collector: TraceCollector;
  private instrumentedClasses = new Set<string>();

  constructor(collector: TraceCollector) {
    this.collector = collector;
  }

  /**
   * Instrument an agent class for automatic tracing
   */
  instrumentAgentClass(AgentClass: any, agentType: string): void {
    if (this.instrumentedClasses.has(AgentClass.name)) {
      return;
    }

    // Instrument constructor
    this.instrumentConstructor(AgentClass, agentType);
    
    // Instrument methods
    this.instrumentMethods(AgentClass.prototype, agentType);
    
    this.instrumentedClasses.add(AgentClass.name);
  }

  /**
   * Instrument agent constructor
   */
  private instrumentConstructor(AgentClass: any, agentType: string): void {
    const originalConstructor = AgentClass;
    
    function InstrumentedConstructor(this: any, ...args: any[]) {
      // Call original constructor
      originalConstructor.apply(this, args);
      
      // Collect spawn event
      this._instrumentationCollector?.collectEvent({
        type: TraceEventType.AGENT_SPAWN,
        agentId: this.id || this.agentId,
        swarmId: this.swarmId || 'default',
        data: {
          agentType,
          constructorArgs: args,
          capabilities: this.capabilities || []
        }
      });
    }

    // Copy prototype and static properties
    InstrumentedConstructor.prototype = AgentClass.prototype;
    Object.setPrototypeOf(InstrumentedConstructor, AgentClass);
    
    return InstrumentedConstructor;
  }

  /**
   * Instrument agent methods
   */
  private instrumentMethods(prototype: any, agentType: string): void {
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => 
        name !== 'constructor' && 
        typeof prototype[name] === 'function' &&
        !name.startsWith('_')
      );

    for (const methodName of methodNames) {
      this.instrumentMethod(prototype, methodName, agentType);
    }
  }

  /**
   * Instrument a specific method
   */
  private instrumentMethod(prototype: any, methodName: string, agentType: string): void {
    const originalMethod = prototype[methodName];
    const collector = this.collector;

    prototype[methodName] = function(this: any, ...args: any[]) {
      const startTime = Date.now();
      const eventId = `${this.id || this.agentId}-${methodName}-${startTime}`;

      // Collect method start event
      collector.collectEvent({
        id: eventId,
        type: this.getTraceEventType(methodName),
        agentId: this.id || this.agentId,
        swarmId: this.swarmId || 'default',
        data: {
          method: methodName,
          arguments: this.sanitizeArguments(args),
          agentType
        }
      });

      try {
        const result = originalMethod.apply(this, args);
        
        // Handle async methods
        if (result && typeof result.then === 'function') {
          return result
            .then((asyncResult: any) => {
              const duration = Date.now() - startTime;
              
              collector.collectEvent({
                id: `${eventId}-complete`,
                type: TraceEventType.TASK_COMPLETE,
                agentId: this.id || this.agentId,
                swarmId: this.swarmId || 'default',
                parentId: eventId,
                duration,
                data: {
                  method: methodName,
                  result: this.sanitizeResult(asyncResult),
                  success: true
                }
              });
              
              return asyncResult;
            })
            .catch((error: any) => {
              const duration = Date.now() - startTime;
              
              collector.collectEvent({
                id: `${eventId}-error`,
                type: TraceEventType.TASK_FAIL,
                agentId: this.id || this.agentId,
                swarmId: this.swarmId || 'default',
                parentId: eventId,
                duration,
                data: {
                  method: methodName,
                  error: error.message || error,
                  success: false
                }
              });
              
              throw error;
            });
        } else {
          // Handle sync methods
          const duration = Date.now() - startTime;
          
          collector.collectEvent({
            id: `${eventId}-complete`,
            type: TraceEventType.TASK_COMPLETE,
            agentId: this.id || this.agentId,
            swarmId: this.swarmId || 'default',
            parentId: eventId,
            duration,
            data: {
              method: methodName,
              result: this.sanitizeResult(result),
              success: true
            }
          });
          
          return result;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        
        collector.collectEvent({
          id: `${eventId}-error`,
          type: TraceEventType.TASK_FAIL,
          agentId: this.id || this.agentId,
          swarmId: this.swarmId || 'default',
          parentId: eventId,
          duration,
          data: {
            method: methodName,
            error: (error as Error).message || error,
            success: false
          }
        });
        
        throw error;
      }
    };

    // Add helper methods to prototype
    if (!prototype.getTraceEventType) {
      prototype.getTraceEventType = function(methodName: string): TraceEventType {
        // TODO: Map method names to appropriate event types
        if (methodName.includes('execute') || methodName.includes('run')) {
          return TraceEventType.TASK_START;
        }
        return TraceEventType.STATE_CHANGE;
      };
    }

    if (!prototype.sanitizeArguments) {
      prototype.sanitizeArguments = function(args: any[]): any[] {
        // TODO: Remove sensitive data from arguments
        return args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return { ...arg, _sanitized: true };
          }
          return arg;
        });
      };
    }

    if (!prototype.sanitizeResult) {
      prototype.sanitizeResult = function(result: any): any {
        // TODO: Remove sensitive data from results
        if (typeof result === 'object' && result !== null) {
          return { ...result, _sanitized: true };
        }
        return result;
      };
    }
  }

  /**
   * Remove instrumentation from a class
   */
  uninstrumentClass(className: string): void {
    // TODO: Restore original methods
    // TODO: Clean up instrumentation
    
    this.instrumentedClasses.delete(className);
  }
}

/**
 * Global instrumentation helpers
 */
export const instrumentation = {
  /**
   * Auto-instrument common Claude Flow classes
   */
  autoInstrument(collector: TraceCollector): AgentInstrumentation {
    const instrumentation = new AgentInstrumentation(collector);
    
    // TODO: Auto-discover and instrument agent classes
    // TODO: Instrument EventBus
    // TODO: Instrument SwarmCoordinator
    
    return instrumentation;
  }
};